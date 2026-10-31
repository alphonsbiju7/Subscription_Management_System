import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  db,
  transaction,
  lock,
  audit,
  digest,
  json,
  outbox,
  type Tx,
} from "../db.js";
import { allow, customerScope, own } from "../access.js";
import { check } from "../errors.js";
import {
  paymentInput,
  pageInput,
  cash as moneyInput,
} from "../../../../packages/validation/src/index.js";
import {
  D,
  sum,
  money,
  paymentState,
  calculateBill,
  type BillInput,
} from "../../../../packages/billing-engine/src/index.js";
import type { Actor } from "../../../../packages/shared-types/src/index.js";
export const finance = Router();
const invoiceInclude = {
  customer: true,
  period: true,
  lines: true,
  allocations: { include: { payment: true } },
  creditApplications: true,
} satisfies Prisma.InvoiceInclude;
type Invoice = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
export function invoiceView(invoice: Invoice) {
  const paid = sum(invoice.allocations.map((a) => a.amount.toString()));
  return {
    ...invoice,
    amountPaid: money(paid),
    ...paymentState(invoice.total.toString(), paid.toString(), invoice.dueAt),
    billingStatus: invoice.status,
  };
}
export async function idempotent<T>(
  tx: Tx,
  key: string,
  actor: Actor,
  operation: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  check(
    key.length >= 8 && key.length <= 120,
    "An Idempotency-Key of 8–120 characters is required",
  );
  const scoped = `${actor.id}:${operation}:${key}`;
  await lock(tx, `idempotency:${scoped}`);
  const old = await tx.idempotency.findUnique({ where: { key: scoped } });
  const hash = digest(input);
  if (old) {
    check(
      old.hash === hash,
      "Idempotency key reused with different input",
      409,
    );
    return old.response as T;
  }
  const result = await fn();
  await tx.idempotency.create({
    data: {
      key: scoped,
      actorId: actor.id,
      operation,
      hash,
      response: json(result),
    },
  });
  return result;
}
export async function recordPayment(
  input: z.infer<typeof paymentInput>,
  actor: Actor,
  key: string,
) {
  return transaction((tx) =>
    idempotent(tx, key, actor, "payment", input, async () => {
      await lock(tx, `customer-finance:${input.customerId}`);
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
      });
      check(customer, "Customer not found", 404);
      check(customer.currency === input.currency, "Currency mismatch");
      check(D(input.amount).gt(0), "Payment must be positive");
      check(
        input.receivedAt <= new Date(Date.now() + 60000),
        "Payment date cannot be in the future",
      );
      check(
        new Set(input.allocations.map((a) => a.invoiceId)).size ===
          input.allocations.length,
        "Duplicate allocation",
      );
      check(
        sum(input.allocations.map((a) => a.amount)).lte(input.amount),
        "Allocations exceed payment",
      );
      for (const a of [...input.allocations].sort((a, b) =>
        a.invoiceId.localeCompare(b.invoiceId),
      )) {
        await lock(tx, `invoice:${a.invoiceId}`);
        const invoice = await tx.invoice.findUnique({
          where: { id: a.invoiceId },
          include: { allocations: true },
        });
        check(
          invoice?.status === "CONFIRMED" &&
            invoice.customerId === customer.id &&
            invoice.currency === input.currency,
          "Allocation requires an issued invoice belonging to this customer and currency",
        );
        const paid = sum(invoice.allocations.map((p) => p.amount.toString()));
        check(
          D(a.amount).gt(0) &&
            D(a.amount).lte(D(invoice.total.toString()).minus(paid)),
          "Allocation exceeds outstanding balance",
        );
      }
      const payment = await tx.payment.create({
        data: {
          customerId: input.customerId,
          reference: input.reference,
          amount: money(input.amount),
          currency: input.currency,
          method: input.method,
          receivedAt: input.receivedAt,
          notes: input.notes,
          recordedBy: actor.id,
          allocations: {
            create: input.allocations.map((a) => ({
              invoiceId: a.invoiceId,
              amount: money(a.amount),
            })),
          },
        },
        include: { allocations: true },
      });
      await audit(
        tx,
        actor.id,
        "PAYMENT_RECORDED",
        payment.id,
        {
          reference: payment.reference,
          amount: payment.amount.toString(),
          allocations: input.allocations,
        },
        actor.requestId,
      );
      await outbox(
        tx,
        `payment:${payment.id}`,
        customer.email,
        "Brightloop payment receipt",
        {
          text: `Payment ${payment.reference}: ${payment.currency} ${payment.amount.toString()} received.`,
        },
      );
      return payment;
    }),
  );
}
finance.get("/invoices", async (req, res) => {
  const q = pageInput.parse(req.query);
  const where: Prisma.InvoiceWhereInput = {
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...customerScope(req.actor),
    number: { contains: q.search, mode: "insensitive" },
    ...(q.from || q.to ? { issuedAt: { gte: q.from, lte: q.to } } : {}),
    ...(q.status && ["DRAFT", "CONFIRMED", "CANCELLED"].includes(q.status)
      ? { status: q.status as "DRAFT" | "CONFIRMED" | "CANCELLED" }
      : {}),
    ...(q.status === "OVERDUE"
      ? { status: "CONFIRMED", dueAt: { lt: new Date() } }
      : {}),
  };
  // Outstanding filtering must precede pagination; an indexed SQL subquery provides the balance test.
  if (["OVERDUE", "OUTSTANDING", "PAID"].includes(q.status ?? "")) {
    const ids = await db.$queryRaw<
      { id: string }[]
    >`SELECT i.id FROM "Invoice" i LEFT JOIN (SELECT "invoiceId", SUM(amount) paid FROM "Allocation" GROUP BY "invoiceId") a ON a."invoiceId"=i.id WHERE i.status='CONFIRMED' AND (${q.status === "PAID"} = (i.total <= COALESCE(a.paid,0)))`;
    where.id = { in: ids.map((i) => i.id) };
  }
  const [items, total] = await Promise.all([
    db.invoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { issuedAt: "desc" },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    db.invoice.count({ where }),
  ]);
  res.json({ items: items.map(invoiceView), total });
});
finance.get("/invoices/:id", async (req, res) => {
  const invoice = await db.invoice.findUnique({
    where: { id: String(req.params.id) },
    include: invoiceInclude,
  });
  check(invoice, "Invoice not found", 404);
  own(req.actor, invoice.customerId);
  const snapshot = invoice.snapshot as { input: BillInput };
  res.json({
    ...invoiceView(invoice),
    explanation: calculateBill(snapshot.input),
    snapshotIntact: digest(invoice.snapshot) === invoice.snapshotHash,
  });
});
finance.post(
  "/invoices/:id/confirm",
  allow("ADMIN", "FINANCE"),
  async (req, res) =>
    res.json(
      await transaction(async (tx) => {
        const id = String(req.params.id);
        await lock(tx, `invoice:${id}`);
        const invoice = await tx.invoice.findUnique({
          where: { id },
          include: { customer: true, lines: true },
        });
        check(invoice, "Invoice not found", 404);
        if (invoice.status === "CONFIRMED") return invoice;
        check(
          invoice.status === "DRAFT",
          "Only draft invoices can be confirmed",
        );
        const expected = calculateBill(
          (invoice.snapshot as { input: BillInput }).input,
        );
        check(
          digest(invoice.snapshot) === invoice.snapshotHash &&
            D(invoice.total.toString()).eq(expected.total) &&
            invoice.lines.length === expected.lines.length &&
            invoice.lines.every((l, i) =>
              D(l.total.toString()).eq(expected.lines[i]!.total),
            ),
          "ProofBill verification failed; review before issuing",
          409,
        );
        const result = await tx.invoice.update({
          where: { id },
          data: { status: "CONFIRMED", confirmedAt: new Date() },
        });
        await audit(tx, req.actor.id, "INVOICE_CONFIRMED", id);
        await outbox(
          tx,
          `invoice:${id}`,
          invoice.customer.email,
          `Invoice ${invoice.number}`,
          {
            text: `Invoice ${invoice.number}: ${invoice.currency} ${invoice.total.toString()}, due ${invoice.dueAt.toISOString()}. Download it from your portal.`,
          },
        );
        return result;
      }),
    ),
);
finance.post(
  "/invoices/:id/cancel",
  allow("ADMIN", "FINANCE"),
  async (req, res) => {
    const { reason } = z
      .object({ reason: z.string().min(8).max(1000) })
      .strict()
      .parse(req.body);
    res.json(
      await transaction(async (tx) => {
        const id = String(req.params.id);
        await lock(tx, `invoice:${id}`);
        const i = await tx.invoice.findUnique({
          where: { id },
          include: { allocations: true, usage: true },
        });
        check(
          i?.status === "DRAFT" &&
            !i.allocations.length &&
            !i.usage.length &&
            i.creditTotal.isZero() &&
            i.discountTotal.isZero(),
          "Only unissued drafts without consumption may be cancelled; issued documents require a credit note",
        );
        const result = await tx.invoice.update({
          where: { id },
          data: { status: "CANCELLED" },
        });
        await audit(tx, req.actor.id, "INVOICE_CANCELLED", id, { reason });
        return result;
      }),
    );
  },
);
finance.get("/payments", async (req, res) => {
  const q = pageInput.parse(req.query),
    where = {
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...customerScope(req.actor),
      reference: { contains: q.search, mode: "insensitive" as const },
    };
  const [items, total] = await Promise.all([
    db.payment.findMany({
      where,
      include: { customer: true, allocations: true, adjustments: true },
      orderBy: { receivedAt: "desc" },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    db.payment.count({ where }),
  ]);
  res.json({
    items: items.map((p) => ({
      ...p,
      unapplied: money(
        D(p.amount.toString())
          .minus(sum(p.allocations.map((a) => a.amount.toString())))
          .minus(
            sum(
              p.adjustments
                .filter((a) => a.status === "APPROVED" && a.kind === "REFUND")
                .map((a) => a.amount.toString()),
            ),
          ),
      ),
    })),
    total,
  });
});
finance.post("/payments", allow("ADMIN", "FINANCE"), async (req, res) => {
  const input = paymentInput.parse(req.body);
  res
    .status(201)
    .json(
      await recordPayment(input, req.actor, req.get("Idempotency-Key") ?? ""),
    );
});
finance.post(
  "/payments/:id/allocate",
  allow("ADMIN", "FINANCE"),
  async (req, res) => {
    const input = z
      .object({ invoiceId: z.string(), amount: moneyInput })
      .strict()
      .parse(req.body);
    res.json(
      await transaction((tx) =>
        idempotent(
          tx,
          req.get("Idempotency-Key") ?? "",
          req.actor,
          `allocate:${req.params.id}`,
          input,
          async () => {
            const paymentId = String(req.params.id);
            const p = await tx.payment.findUnique({
              where: { id: paymentId },
              include: { allocations: true, adjustments: true },
            });
            check(p, "Payment not found", 404);
            await lock(tx, `customer-finance:${p.customerId}`);
            await lock(tx, `invoice:${input.invoiceId}`);
            const i = await tx.invoice.findUnique({
              where: { id: input.invoiceId },
              include: { allocations: true },
            });
            check(
              i?.status === "CONFIRMED" &&
                i.customerId === p.customerId &&
                i.currency === p.currency,
              "Ineligible invoice",
            );
            const refunded = sum(
              p.adjustments
                .filter((a) => a.kind === "REFUND" && a.status === "APPROVED")
                .map((a) => a.amount.toString()),
            );
            check(
              D(input.amount).gt(0) &&
                D(input.amount).lte(
                  D(p.amount.toString())
                    .minus(sum(p.allocations.map((a) => a.amount.toString())))
                    .minus(refunded),
                ) &&
                D(input.amount).lte(
                  D(i.total.toString()).minus(
                    sum(i.allocations.map((a) => a.amount.toString())),
                  ),
                ),
              "Allocation exceeds available amount",
            );
            const result = await tx.allocation.create({
              data: { paymentId, invoiceId: i.id, amount: money(input.amount) },
            });
            await audit(
              tx,
              req.actor.id,
              "PAYMENT_ALLOCATED",
              paymentId,
              input,
            );
            return result;
          },
        ),
      ),
    );
  },
);
finance.get("/credits", async (req, res) => {
  const q = pageInput.parse(req.query);
  const where = {
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...customerScope(req.actor),
    reason: { contains: q.search, mode: "insensitive" as const },
  };
  res.json({
    items: await db.creditEntry.findMany({
      where,
      include: { customer: true, applications: true },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { createdAt: "desc" },
    }),
    adjustments: await db.adjustment.findMany({
      where,
      include: { customer: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    }),
    total: await db.creditEntry.count({ where }),
  });
});
finance.post(
  "/adjustments",
  allow("ADMIN", "FINANCE", "SUPPORT"),
  async (req, res) => {
    const input = z
      .object({
        customerId: z.string(),
        paymentId: z.string().optional(),
        kind: z.enum(["CREDIT_NOTE", "PREPAID", "GRANT", "REFUND"]),
        amount: moneyInput,
        currency: z.enum(["INR", "USD", "EUR", "GBP"]),
        reason: z.string().min(8).max(2000),
      })
      .strict()
      .parse(req.body);
    check(D(input.amount).gt(0), "Amount must be positive");
    res.status(201).json(
      await transaction((tx) =>
        idempotent(
          tx,
          req.get("Idempotency-Key") ?? "",
          req.actor,
          "adjustment",
          input,
          async () => {
            const customer = await tx.customer.findUnique({
              where: { id: input.customerId },
            });
            check(
              customer?.currency === input.currency,
              "Customer currency mismatch",
            );
            const item = await tx.adjustment.create({
              data: {
                ...input,
                requestedBy: req.actor.id,
                amount: money(input.amount),
              },
            });
            await audit(
              tx,
              req.actor.id,
              "ADJUSTMENT_REQUESTED",
              item.id,
              input,
            );
            return item;
          },
        ),
      ),
    );
  },
);
finance.post(
  "/adjustments/:id/decide",
  allow("ADMIN", "FINANCE"),
  async (req, res) => {
    const input = z
      .object({
        approve: z.boolean(),
        expiresAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await transaction((tx) =>
        idempotent(
          tx,
          req.get("Idempotency-Key") ?? "",
          req.actor,
          `decide:${req.params.id}`,
          input,
          async () => {
            const id = String(req.params.id);
            await lock(tx, `adjustment:${id}`);
            const a = await tx.adjustment.findUnique({ where: { id } });
            check(a?.status === "REQUESTED", "Adjustment already decided");
            check(
              a.requestedBy !== req.actor.id,
              "A separate authorized person must review this request",
              403,
            );
            await lock(tx, `customer-finance:${a.customerId}`);
            await lock(tx, `credits:${a.customerId}`);
            if (input.approve && a.kind === "REFUND") {
              check(a.paymentId, "Refund requires a payment reference");
              const p = await tx.payment.findUnique({
                where: { id: a.paymentId },
                include: { adjustments: true, allocations: true },
              });
              check(
                p?.customerId === a.customerId && p.currency === a.currency,
                "Invalid refund payment",
              );
              const refunded = sum(
                p.adjustments
                  .filter((r) => r.status === "APPROVED" && r.kind === "REFUND")
                  .map((r) => r.amount.toString()),
              );
              check(
                D(a.amount.toString()).lte(
                  D(p.amount.toString())
                    .minus(refunded)
                    .minus(sum(p.allocations.map((r) => r.amount.toString()))),
                ),
                "Refund exceeds unapplied payment; issued invoice refunds require a credit/reversal workflow",
              );
            }
            if (input.approve && a.kind === "DRAFT_CORRECTION") {
              check(a.invoiceId, "Correction requires an invoice");
              await lock(tx, `invoice:${a.invoiceId}`);
              const invoice = await tx.invoice.findUnique({
                where: { id: a.invoiceId },
                include: { lines: true },
              });
              check(
                invoice?.status === "DRAFT" &&
                  digest(invoice.snapshot) === invoice.snapshotHash,
                "Only intact unissued drafts can be corrected",
              );
              const expected = calculateBill(
                (invoice.snapshot as { input: BillInput }).input,
              );
              check(
                invoice.lines.length === expected.lines.length,
                "Line count differs; manual agreement review required",
              );
              const before = {
                total: invoice.total.toString(),
                lines: invoice.lines,
              };
              await tx.invoice.update({
                where: { id: invoice.id },
                data: {
                  subtotal: expected.subtotal,
                  discountTotal: expected.discountTotal,
                  taxTotal: expected.taxTotal,
                  creditTotal: expected.creditTotal,
                  total: expected.total,
                },
              });
              for (let i = 0; i < invoice.lines.length; i++) {
                const l = expected.lines[i]!;
                await tx.invoiceLine.update({
                  where: { id: invoice.lines[i]!.id },
                  data: {
                    description: l.description,
                    quantity: l.quantity,
                    unitPrice: l.unitPrice,
                    subtotal: l.subtotal,
                    discount: l.discount,
                    tax: l.tax,
                    total: l.total,
                    details: json(l),
                  },
                });
              }
              await tx.discrepancy.updateMany({
                where: { invoiceId: invoice.id, status: "UNDER_REVIEW" },
                data: {
                  status: "CORRECTED",
                  reviewedBy: req.actor.id,
                  reason: `Approved adjustment ${a.id}: ${a.reason}`,
                },
              });
              await audit(
                tx,
                req.actor.id,
                "DRAFT_INVOICE_CORRECTED",
                invoice.id,
                { adjustmentId: a.id, before, after: expected },
              );
            }
            if (
              input.approve &&
              !["REFUND", "DRAFT_CORRECTION"].includes(a.kind)
            )
              await tx.creditEntry.create({
                data: {
                  customerId: a.customerId,
                  adjustmentId: a.id,
                  currency: a.currency,
                  amount: a.amount,
                  reason: a.reason,
                  expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
                },
              });
            const result = await tx.adjustment.update({
              where: { id },
              data: {
                status: input.approve ? "APPROVED" : "REJECTED",
                approvedBy: req.actor.id,
                decidedAt: new Date(),
              },
            });
            await audit(tx, req.actor.id, "ADJUSTMENT_DECIDED", id, input);
            return result;
          },
        ),
      ),
    );
  },
);
