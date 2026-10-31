import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { allow } from "../access.js";
import { pageInput } from "../../../../packages/validation/src/index.js";
import {
  money,
  sum,
  normalizedMRR,
  priceCharge,
  D,
} from "../../../../packages/billing-engine/src/index.js";
import { csvCell } from "./customers.js";
import type { Contract } from "./sales.js";
export const reports = Router();
export async function dashboard(
  actor: { role: string; customerId: string | null },
  query: Record<string, unknown>,
) {
  const q = pageInput.parse(query),
    currency = z
      .enum(["INR", "USD", "EUR", "GBP"])
      .default("INR")
      .parse(query.currency);
  const customerId =
    actor.role === "CUSTOMER" ? (actor.customerId ?? "__none__") : q.customerId;
  const since = q.from ?? new Date(new Date().getFullYear(), 0, 1),
    until = q.to ?? new Date();
  const where: Prisma.SubscriptionWhereInput = {
    currency,
    ...(customerId ? { customerId } : {}),
    ...(q.status
      ? {
          status: z
            .enum([
              "ACTIVE",
              "PAUSED",
              "CLOSED",
              "CONFIRMED",
              "DRAFT",
              "QUOTATION",
            ])
            .parse(q.status),
        }
      : {}),
    ...(q.planId
      ? { items: { some: { planVersion: { planId: q.planId } } } }
      : {}),
    ...(q.productId
      ? {
          items: {
            some: { planVersion: { plan: { productId: q.productId } } },
          },
        }
      : {}),
  };
  const subFilter = Prisma.sql`AND (${customerId ?? null}::text IS NULL OR i."customerId"=${customerId ?? null}) AND (${q.planId ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM "SubscriptionItem" si JOIN "PlanVersion" pv ON pv.id=si."planVersionId" WHERE si."subscriptionId"=i."subscriptionId" AND pv."planId"=${q.planId ?? null})) AND (${q.productId ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM "SubscriptionItem" si JOIN "PlanVersion" pv ON pv.id=si."planVersionId" JOIN "Plan" p ON p.id=pv."planId" WHERE si."subscriptionId"=i."subscriptionId" AND p."productId"=${q.productId ?? null})) AND (${q.status ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM "Subscription" s WHERE s.id=i."subscriptionId" AND s.status::text=${q.status ?? null}))`;
  const [invoiceTotals, cash, status, active, trend, aging, recent] =
    await Promise.all([
      db.$queryRaw<
        {
          invoiced: Prisma.Decimal;
          outstanding: Prisma.Decimal;
          overdue: Prisma.Decimal;
          tax: Prisma.Decimal;
          discount: Prisma.Decimal;
          credits: Prisma.Decimal;
          count: bigint;
        }[]
      >(
        Prisma.sql`SELECT COALESCE(SUM(i.total),0) invoiced, COALESCE(SUM(GREATEST(i.total-COALESCE(a.paid,0),0)),0) outstanding, COALESCE(SUM(CASE WHEN i."dueAt"<NOW() THEN GREATEST(i.total-COALESCE(a.paid,0),0) ELSE 0 END),0) overdue, COALESCE(SUM(i."taxTotal"),0) tax, COALESCE(SUM(i."discountTotal"),0) discount, COALESCE(SUM(i."creditTotal"),0) credits, COUNT(*) count FROM "Invoice" i LEFT JOIN (SELECT "invoiceId",SUM(amount) paid FROM "Allocation" GROUP BY "invoiceId") a ON a."invoiceId"=i.id WHERE i.status='CONFIRMED' AND i.currency=${currency} AND i."issuedAt">=${since} AND i."issuedAt"<=${until} ${subFilter}`,
      ),
      db.payment.aggregate({
        where: {
          currency,
          ...(customerId ? { customerId } : {}),
          receivedAt: { gte: since, lte: until },
        },
        _sum: { amount: true },
      }),
      db.subscription.groupBy({ by: ["status"], where, _count: true }),
      db.subscription.findMany({
        where: { ...where, status: "ACTIVE" },
        select: {
          interval: true,
          customerId: true,
          items: {
            select: { quantity: true, unitPrice: true, snapshot: true },
          },
        },
        take: 10001,
      }),
      db.$queryRaw<
        { month: string; invoiced: Prisma.Decimal; collected: Prisma.Decimal }[]
      >(
        Prisma.sql`WITH months AS (SELECT generate_series(date_trunc('month',${since}::timestamptz),date_trunc('month',${until}::timestamptz),INTERVAL '1 month') m) SELECT to_char(m,'Mon YY') AS "month", COALESCE((SELECT SUM(i.total) FROM "Invoice" i WHERE i.status='CONFIRMED' AND i.currency=${currency} AND i."issuedAt">=m AND i."issuedAt"<m+INTERVAL '1 month' AND i."issuedAt">=${since} AND i."issuedAt"<=${until} ${subFilter}),0) invoiced, COALESCE((SELECT SUM(p.amount) FROM "Payment" p WHERE p.currency=${currency} AND p."receivedAt">=m AND p."receivedAt"<m+INTERVAL '1 month' AND p."receivedAt">=${since} AND p."receivedAt"<=${until} AND (${customerId ?? null}::text IS NULL OR p."customerId"=${customerId ?? null})),0) collected FROM months ORDER BY m LIMIT 60`,
      ),
      db.$queryRaw<{ bucket: string; amount: Prisma.Decimal }[]>(
        Prisma.sql`SELECT CASE WHEN i."dueAt">=NOW() THEN 'Current' WHEN i."dueAt">=NOW()-INTERVAL '30 days' THEN '1–30 days' WHEN i."dueAt">=NOW()-INTERVAL '60 days' THEN '31–60 days' WHEN i."dueAt">=NOW()-INTERVAL '90 days' THEN '61–90 days' ELSE '90+ days' END bucket, SUM(GREATEST(i.total-COALESCE(a.paid,0),0)) amount FROM "Invoice" i LEFT JOIN (SELECT "invoiceId",SUM(amount) paid FROM "Allocation" GROUP BY "invoiceId") a ON a."invoiceId"=i.id WHERE i.status='CONFIRMED' AND i.currency=${currency} AND i."issuedAt">=${since} AND i."issuedAt"<=${until} ${subFilter} GROUP BY bucket`,
      ),
      db.invoice.findMany({
        where: { currency, ...(customerId ? { customerId } : {}) },
        include: {
          customer: { select: { name: true } },
          allocations: { select: { amount: true } },
        },
        orderBy: { issuedAt: "desc" },
        take: 6,
      }),
    ]);
  const mrr = sum(
    active.map((s) =>
      normalizedMRR(
        sum(
          s.items.map((i) => {
            const c = i.snapshot as unknown as Contract;
            return D(
              priceCharge({
                model: c.model,
                unitPrice: i.unitPrice.toString(),
                quantity: String(i.quantity),
                tiers: c.tiers,
                packageSize: c.packageSize,
              }),
            ).plus(c.addonCharge);
          }),
        ).toString(),
        s.interval,
      ),
    ),
  );
  return {
    currency,
    from: since,
    to: until,
    invoiced: money(invoiceTotals[0]?.invoiced.toString() ?? "0"),
    outstanding: money(invoiceTotals[0]?.outstanding.toString() ?? "0"),
    overdue: money(invoiceTotals[0]?.overdue.toString() ?? "0"),
    tax: money(invoiceTotals[0]?.tax.toString() ?? "0"),
    discount: money(invoiceTotals[0]?.discount.toString() ?? "0"),
    credits: money(invoiceTotals[0]?.credits.toString() ?? "0"),
    collected: money(cash._sum.amount?.toString() ?? "0"),
    mrr: money(mrr),
    arr: money(mrr.mul(12)),
    arpa: money(
      mrr.div(Math.max(new Set(active.map((s) => s.customerId)).size, 1)),
    ),
    subscriptionStatus: status.map((s) => ({
      status: s.status,
      count: s._count,
    })),
    activeSubscriptions: active.length,
    trend: trend.map((t) => ({
      ...t,
      invoiced: money(t.invoiced.toString()),
      collected: money(t.collected.toString()),
    })),
    aging: aging.map((a) => ({ ...a, amount: money(a.amount.toString()) })),
    recentInvoices: recent.map((i) => ({
      ...i,
      outstanding: money(
        D(i.total.toString()).minus(
          sum(i.allocations.map((a) => a.amount.toString())),
        ),
      ),
    })),
    metricsNotes:
      "MRR is current contracted recurring charges before tax, discounts, setup, credits and usage. Cash is gross receipts by received date; cash totals are customer/currency/date scoped and are not attributed to product/plan. Issued invoice totals are billing, not recognized revenue. MRR is capped at 10,001 active contracts per query; larger installations require an aggregate projection.",
    gateways: [],
  };
}
reports.get("/reports/dashboard", async (req, res) =>
  res.json(await dashboard(req.actor, req.query)),
);
reports.get("/reports/export", allow("ADMIN", "FINANCE"), async (req, res) => {
  const data = await dashboard(req.actor, req.query);
  const keys = [
    "currency",
    "from",
    "to",
    "invoiced",
    "collected",
    "outstanding",
    "overdue",
    "mrr",
    "arr",
    "arpa",
    "tax",
    "discount",
    "credits",
  ] as const;
  res
    .type("csv")
    .attachment("brightloop-financial-report.csv")
    .send(
      [
        "metric,value",
        ...keys.map((k) =>
          [k, data[k] instanceof Date ? data[k].toISOString() : data[k]]
            .map(csvCell)
            .join(","),
        ),
      ].join("\r\n"),
    );
});
reports.get(
  "/reports/revenue-schedule",
  allow("ADMIN", "FINANCE"),
  async (req, res) => {
    const q = pageInput.parse(req.query);
    const items = await db.invoice.findMany({
      where: {
        status: "CONFIRMED",
        ...(q.customerId ? { customerId: q.customerId } : {}),
      },
      include: { period: true },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { issuedAt: "desc" },
    });
    res.json({
      rule: "Illustrative straight-line elapsed-time allocation of net billed service charges excluding tax. Credit/refund impacts are not yet allocated. Not GAAP/IFRS accounting.",
      items: items.map((i) => {
        const length = i.period.endAt.getTime() - i.period.startAt.getTime(),
          elapsed = Math.max(
            0,
            Math.min(length, Date.now() - i.period.startAt.getTime()),
          ),
          base = D(i.total.toString()).minus(i.taxTotal.toString());
        const recognized = base.mul(elapsed).div(length);
        return {
          id: i.id,
          number: i.number,
          currency: i.currency,
          period: i.period,
          recognized: money(recognized),
          deferred: money(base.minus(recognized)),
        };
      }),
    });
  },
);
reports.get("/notifications", async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.actor.id } });
  const where =
    req.actor.role === "ADMIN" || req.actor.role === "FINANCE"
      ? {}
      : { recipient: user?.email ?? "__none__" };
  const items = await db.outbox.findMany({
    where,
    select: {
      id: true,
      kind: true,
      recipient: true,
      subject: true,
      status: true,
      attempts: true,
      createdAt: true,
      sentAt: true,
      lastError: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ items });
});
reports.get("/audit", allow("ADMIN", "FINANCE"), async (req, res) => {
  const q = pageInput.parse(req.query),
    where = q.search
      ? {
          OR: [
            { action: { contains: q.search, mode: "insensitive" as const } },
            { target: { contains: q.search, mode: "insensitive" as const } },
          ],
        }
      : {};
  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.auditLog.count({ where }),
  ]);
  res.json({ items, total });
});
