import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../db.js";
import { config } from "../config.js";
import { check } from "../errors.js";
import { dashboard } from "./reports.js";
import { D, money, sum, paymentState } from "../../../../packages/billing-engine/src/index.js";
import type { Actor } from "../../../../packages/shared-types/src/index.js";
import type { Contract } from "./sales.js";

export type ChatSource = { label: string; path: string };
export type ChatToolResult = { data: unknown; sources: ChatSource[] };

export function canReadChatData(role: string) {
  return role === "ADMIN" || role === "CUSTOMER";
}

const periods = ["last_month", "this_month", "last_30_days", "this_year", "last_year", "all_time", "custom"] as const;
const periodInput = z.object({
  period: z.enum(periods).default("this_month"),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]).default("INR"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict();

export function chatPeriod(args: z.infer<typeof periodInput>, now: DateTime = DateTime.now()) {
  const local = now.setZone(config.BUSINESS_TIMEZONE);
  check(local.isValid, "Business timezone is invalid", 503);
  let start: DateTime = local.startOf("month"), end: DateTime = local;
  switch (args.period) {
    case "last_month": start = start.minus({ months: 1 }); end = local.startOf("month"); break;
    case "last_30_days": start = local.minus({ days: 30 }); break;
    case "this_year": start = local.startOf("year"); break;
    case "last_year": start = local.startOf("year").minus({ years: 1 }); end = local.startOf("year"); break;
    case "all_time": start = DateTime.fromMillis(0, { zone: config.BUSINESS_TIMEZONE }); break;
    case "custom": {
      check(args.from && args.to, "Custom periods require from and to dates");
      start = DateTime.fromISO(args.from, { zone: config.BUSINESS_TIMEZONE }).startOf("day");
      end = DateTime.fromISO(args.to, { zone: config.BUSINESS_TIMEZONE }).plus({ days: 1 }).startOf("day");
      check(start.isValid && end.isValid && end > start && end.diff(start, "days").days <= 366,
        "Choose a valid period of up to 366 days");
      break;
    }
  }
  // Report filters have an inclusive upper bound. Calendar periods use an exclusive next boundary.
  const calendar = ["last_month", "last_year", "custom"].includes(args.period);
  return { start, end: calendar ? end.minus({ milliseconds: 1 }) : end };
}

const listInput = z.object({
  search: z.string().trim().max(100).default(""),
  page: z.number().int().min(1).max(100).default(1),
  limit: z.number().int().min(1).max(20).default(10),
}).strict();
const companyInput = listInput.extend({ activeSubscriptionsOnly: z.boolean().default(true) }).strict();
const subscriptionInput = listInput.extend({
  status: z.enum(["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"]).optional(),
  renewingWithinDays: z.number().int().min(1).max(366).optional(),
}).strict();
const invoiceInput = listInput.extend({ status: z.enum(["DRAFT", "CONFIRMED", "CANCELLED"]).optional() }).strict();

function tool(name: string, description: string, properties: Record<string, unknown> = {}): ChatCompletionTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, additionalProperties: false } } };
}
const listProperties = {
  search: { type: "string", description: "Filter by record number or visible name; max 100 characters." },
  page: { type: "integer", minimum: 1, maximum: 100 },
  limit: { type: "integer", minimum: 1, maximum: 20 },
};

export function chatToolsFor(role: string): ChatCompletionTool[] {
  if (!canReadChatData(role)) return [];
  return [
    tool("get_financial_summary", "Read exact billing/report totals. Use last_month for last calendar month's revenue. Distinguish billed net of tax, billed total, and gross cash collected; these are not recognized revenue. Default currency INR; never combine currencies. Use all_time for overall outstanding balances. Customer results cover only their own account; admin results cover the workspace. Current MRR is a current metric, not historical.", {
      period: { type: "string", enum: periods }, currency: { type: "string", enum: ["INR", "USD", "EUR", "GBP"] },
      from: { type: "string", description: "YYYY-MM-DD, required for custom period." },
      to: { type: "string", description: "YYYY-MM-DD inclusive, required for custom period; max 366 days." },
    }),
    tool("get_my_account", "Read the signed-in user's own profile and linked customer account. Never accepts another user or customer ID."),
    ...(role === "ADMIN" ? [tool("list_companies", "List customer companies served by this workspace, with counts of active subscriptions. Only ADMIN can use this tool. Paginated; do not describe a partial page as all companies.", {
      ...listProperties, activeSubscriptionsOnly: { type: "boolean", description: "Default true: companies with active subscriptions only." },
    })] : []),
    tool("list_subscriptions", "Read permitted subscriptions, plan names and quantities, statuses and next billing dates. Customer scope is enforced by the server. renewingWithinDays filters upcoming billing dates. Paginated; never total a partial list as all records.", {
      ...listProperties, status: { type: "string", enum: ["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"] },
      renewingWithinDays: { type: "integer", minimum: 1, maximum: 366 },
    }),
    tool("list_invoices", "Read a page of permitted invoices with exact paid/outstanding amounts. status is billing status, not payment status. For total balances use get_financial_summary with all_time. Never total a partial page as the full balance.", {
      ...listProperties, status: { type: "string", enum: ["DRAFT", "CONFIRMED", "CANCELLED"] },
    }),
    tool("get_invoice_details", "Read one invoice by its exact number or ID, including its line items and allocations. Ownership is enforced even if a different customer's ID is supplied.", { invoice: { type: "string", description: "Exact invoice number or ID." } }),
    tool("list_payments", "Read permitted payment receipts and their allocations. Paginated; use financial_summary for totals.", listProperties),
    tool("get_usage_allowance", "Read unbilled usage and included allowance for a permitted subscription. Get its exact ID with list_subscriptions first.", { subscriptionId: { type: "string" } }),
  ];
}

async function scopeFor(actor: Actor) {
  check(canReadChatData(actor.role), "This role has workflow help only; database lookups are unavailable.", 403);
  if (actor.role === "ADMIN") return {};
  // Verify both IDs together, including when the customer link is missing. Never fall back to {}.
  check(actor.customerId, "Customer account unavailable", 403);
  const own = await db.customer.findFirst({ where: { id: actor.customerId, userId: actor.id }, select: { id: true } });
  check(own, "Customer account unavailable", 403);
  return { customerId: own.id };
}

const customerName = { name: true, company: true } as const;
const invoiceSelect = {
  id: true, number: true, status: true, currency: true, issuedAt: true, dueAt: true,
  subtotal: true, discountTotal: true, taxTotal: true, creditTotal: true, total: true,
  customer: { select: customerName }, allocations: { select: { amount: true } },
} as const;

function invoiceAmounts(row: { total: { toString(): string }; dueAt: Date; status: string; allocations: { amount: { toString(): string } }[] }) {
  const paid = sum(row.allocations.map((a) => a.amount.toString()));
  return { amountPaid: money(paid), ...paymentState(row.total.toString(), paid.toString(), row.dueAt),
    payable: row.status === "CONFIRMED", notes: "Drafts are not issued receivables; cancelled invoices are not payable." };
}

export async function runChatTool(actor: Actor, name: string, args: unknown): Promise<ChatToolResult> {
  const scope = await scopeFor(actor);
  // This allowlist is checked independently of the model's advertised tools.
  check(chatToolsFor(actor.role).some((t) => t.type === "function" && t.function?.name === name), "Lookup not permitted", 403);
  switch (name) {
    case "get_financial_summary": {
      const q = periodInput.parse(args), range = chatPeriod(q);
      const report = await dashboard(actor, { currency: q.currency, from: range.start.toUTC().toISO(), to: range.end.toUTC().toISO() });
      return { data: {
        scope: actor.role === "ADMIN" ? "Admin workspace" : "Signed-in customer only",
        currency: q.currency, timezone: config.BUSINESS_TIMEZONE,
        from: range.start.toISO(), to: range.end.toISO(), readAt: new Date().toISOString(),
        invoicedIncludingTax: report.invoiced,
        billedExcludingTax: money(D(report.invoiced).minus(report.tax)),
        grossPaymentsCollected: report.collected, tax: report.tax, discounts: report.discount, credits: report.credits,
        outstandingOnInvoicesIssuedInPeriod: report.outstanding, overdueOnInvoicesIssuedInPeriod: report.overdue,
        currentMRR: report.mrr, currentARR: report.arr, currentActiveSubscriptions: report.activeSubscriptions,
        notes: "Confirmed invoices only. Billing is not recognized revenue. Cash is gross receipts by received date, not net of refunds. Outstanding uses current allocations on invoices issued in the selected period, not a historical balance. MRR/ARR and active subscriptions are current, not period-end. " + report.metricsNotes,
      }, sources: [{ label: "Reports", path: "/reports" }] };
    }
    case "get_my_account": {
      z.object({}).strict().parse(args);
      const profile = await db.user.findUnique({ where: { id: actor.id }, select: {
        name: true, email: true, role: true,
        customer: { select: { name: true, company: true, currency: true, paymentTerms: true, active: true } },
      } });
      return { data: profile, sources: [{ label: "My account", path: "/account" }] };
    }
    case "list_companies": {
      const q = companyInput.parse(args);
      const where = { active: true, ...(q.activeSubscriptionsOnly ? { subscriptions: { some: { status: "ACTIVE" as const } } } : {}),
        OR: [{ company: { contains: q.search, mode: "insensitive" as const } }, { name: { contains: q.search, mode: "insensitive" as const } }] };
      const [items, total] = await Promise.all([
        db.customer.findMany({ where, select: { name: true, company: true, currency: true, _count: { select: { subscriptions: { where: { status: "ACTIVE" } } } } }, orderBy: { id: "asc" }, take: q.limit, skip: (q.page - 1) * q.limit }),
        db.customer.count({ where }),
      ]);
      return { data: { items, total, page: q.page, pageSize: q.limit, activeSubscriptionsOnly: q.activeSubscriptionsOnly }, sources: [{ label: "Customers", path: "/customers" }] };
    }
    case "list_subscriptions": {
      const q = subscriptionInput.parse(args);
      const where = { ...scope, ...(q.status ? { status: q.status } : {}),
        ...(q.renewingWithinDays ? { nextBillingAt: { gte: new Date(), lte: DateTime.now().plus({ days: q.renewingWithinDays }).toJSDate() }, status: "ACTIVE" as const } : {}),
        OR: [{ number: { contains: q.search, mode: "insensitive" as const } }, { items: { some: { description: { contains: q.search, mode: "insensitive" as const } } } }] };
      const [items, total] = await Promise.all([
        db.subscription.findMany({ where, select: { id: true, number: true, status: true, currency: true, interval: true,
          startAt: true, endAt: true, nextBillingAt: true, autoRenew: true, cancelAtEnd: true,
          customer: { select: customerName }, items: { select: { description: true, quantity: true, unitPrice: true } } },
          orderBy: { nextBillingAt: "asc" }, take: q.limit, skip: (q.page - 1) * q.limit }),
        db.subscription.count({ where }),
      ]);
      return { data: { items, total, page: q.page, pageSize: q.limit }, sources: items.map((i) => ({ label: i.number, path: `/subscriptions/${encodeURIComponent(i.id)}` })) };
    }
    case "list_invoices": {
      const q = invoiceInput.parse(args);
      const where = { ...scope, ...(q.status ? { status: q.status } : {}), number: { contains: q.search, mode: "insensitive" as const } };
      const [items, total] = await Promise.all([
        db.invoice.findMany({ where, select: invoiceSelect, orderBy: { issuedAt: "desc" }, take: q.limit, skip: (q.page - 1) * q.limit }),
        db.invoice.count({ where }),
      ]);
      return { data: { items: items.map(({ allocations: _allocations, ...row }, i) => ({ ...row, ...invoiceAmounts(items[i]!) })), total, page: q.page, pageSize: q.limit },
        sources: items.map((i) => ({ label: i.number, path: `/invoices/${encodeURIComponent(i.id)}` })) };
    }
    case "get_invoice_details": {
      const q = z.object({ invoice: z.string().trim().min(1).max(100) }).strict().parse(args);
      const row = await db.invoice.findFirst({ where: { ...scope, OR: [{ id: q.invoice }, { number: q.invoice }] }, select: {
        ...invoiceSelect, period: { select: { startAt: true, endAt: true } },
        lines: { select: { description: true, quantity: true, unitPrice: true, subtotal: true, discount: true, tax: true, total: true } },
      } });
      check(row, "Record not found or unavailable to this account", 404);
      const { allocations: _allocations, ...invoice } = row;
      return { data: { ...invoice, ...invoiceAmounts(row) }, sources: [{ label: row.number, path: `/invoices/${encodeURIComponent(row.id)}` }] };
    }
    case "list_payments": {
      const q = listInput.parse(args);
      const where = { ...scope, reference: { contains: q.search, mode: "insensitive" as const } };
      const [items, total] = await Promise.all([
        db.payment.findMany({ where, select: { id: true, reference: true, amount: true, currency: true, method: true, receivedAt: true,
          customer: { select: customerName }, allocations: { select: { amount: true, invoice: { select: { number: true } } } } },
          orderBy: { receivedAt: "desc" }, take: q.limit, skip: (q.page - 1) * q.limit }),
        db.payment.count({ where }),
      ]);
      return { data: { items, total, page: q.page, pageSize: q.limit }, sources: items.map((p) => ({ label: p.reference, path: `/payments/${encodeURIComponent(p.id)}` })) };
    }
    case "get_usage_allowance": {
      const q = z.object({ subscriptionId: z.string().min(1).max(100) }).strict().parse(args);
      const sub = await db.subscription.findFirst({ where: { ...scope, id: q.subscriptionId }, select: { id: true, number: true, status: true, items: { select: { snapshot: true } } } });
      check(sub, "Record not found or unavailable to this account", 404);
      const used = await db.usageEvent.aggregate({ where: { subscriptionId: sub.id, invoiceId: null }, _sum: { quantity: true } });
      const consumed = used._sum.quantity?.toString() ?? "0";
      const contracts = sub.items.map((i) => i.snapshot as unknown as Contract);
      const included = sum(contracts.map((c) => c.includedUsage));
      return { data: { subscription: sub.number, status: sub.status, included: included.toString(), consumed,
        remaining: included.gt(consumed) ? included.minus(consumed).toString() : "0", features: contracts.map((c) => c.entitlements),
        notes: "Usage is received, unbilled usage; late events can roll forward. Inactive subscriptions do not grant active entitlements." },
        sources: [{ label: sub.number, path: `/subscriptions/${encodeURIComponent(sub.id)}` }] };
    }
    default: throw new Error("Unknown lookup");
  }
}
