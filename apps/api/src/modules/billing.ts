import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import {
  db,
  transaction,
  lock,
  audit,
  number,
  json,
  digest,
  type Tx,
} from "../db.js";
import { check } from "../errors.js";
import { allow, own } from "../access.js";
import {
  D,
  sum,
  money,
  calculateBill,
  nextBoundary,
  type InputLine,
  type BillInput,
} from "../../../../packages/billing-engine/src/index.js";
import type { Contract } from "./sales.js";
import { pageInput } from "../../../../packages/validation/src/index.js";
export const billing = Router();
const include = {
  items: { include: { planVersion: true } },
  customer: true,
  discount: true,
} satisfies Prisma.SubscriptionInclude;
type Subscription = Prisma.SubscriptionGetPayload<{ include: typeof include }>;

async function prepare(tx: Tx, sub: Subscription, first: boolean) {
  const usage = await tx.usageEvent.findMany({
    where: {
      subscriptionId: sub.id,
      invoiceId: null,
      occurredAt: { lt: sub.nextBillingAt },
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 10001,
  });
  check(
    usage.length <= 10000,
    "Usage batch exceeds 10,000 events; aggregate before billing",
  );
  const lines: InputLine[] = sub.items.map((item) => {
    const c = item.snapshot as unknown as Contract;
    return {
      description: item.description,
      model: c.model,
      quantity: String(item.quantity),
      unitPrice: item.unitPrice.toString(),
      tiers: c.tiers,
      packageSize: c.packageSize,
      extra: D(c.addonCharge)
        .plus(first ? c.setupFee : 0)
        .toString(),
      tax: c.tax,
      sourceId: item.id,
      productId: c.productId,
      discountEligible:
        !sub.discount?.productId || sub.discount.productId === c.productId,
    };
  });
  if (usage.length) {
    check(sub.items.length === 1, "Usage requires a single metered plan");
    const c = sub.items[0]!.snapshot as unknown as Contract;
    const quantity = D(sum(usage.map((u) => u.quantity.toString()))).minus(
      c.includedUsage,
    );
    lines.push({
      description: "Metered usage (arrears; allowance applied per invoice)",
      model: "QUANTITY",
      quantity: D(quantity).lt(0) ? "0" : quantity.toString(),
      unitPrice: c.usageRate,
      tax: c.tax,
      discountEligible: false,
      sourceId: usage.map((u) => u.eventId).join(","),
    });
  }
  const credits = await tx.creditEntry.findMany({
    where: {
      customerId: sub.customerId,
      currency: sub.currency,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { applications: true },
    orderBy: [
      { expiresAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ],
  });
  const available = credits
    .map((c) => ({
      id: c.id,
      remaining: D(c.amount.toString()).minus(
        sum(c.applications.map((a) => a.amount.toString())),
      ),
    }))
    .filter((c) => c.remaining.gt(0));
  const discount = sub.discount;
  const input: BillInput = {
    at: sub.nextBillingAt.toISOString(),
    taxExempt: sub.customer.taxExempt,
    lines,
    credit: sum(available.map((c) => c.remaining)).toString(),
    discount:
      discount &&
      (!discount.customerId || discount.customerId === sub.customerId)
        ? {
            type: discount.type,
            value: discount.value.toString(),
            startsAt: discount.startsAt.toISOString(),
            endsAt: discount.endsAt.toISOString(),
            minimum: discount.minimum.toString(),
            minQuantity: discount.minQuantity,
            used: discount.used,
            usageLimit: discount.usageLimit,
            active: discount.active,
          }
        : null,
  };
  return { input, result: calculateBill(input), usage, available };
}
/** Invoice + lines + cursor + usage + credits + notification commit atomically. */
export async function billOne(
  subscriptionId: string,
  now = new Date(),
  actorId = "worker",
) {
  return transaction(async (tx) => {
    await lock(tx, `subscription:${subscriptionId}`);
    let sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include,
    });
    check(sub, "Subscription not found", 404);
    if (sub.status !== "ACTIVE" || sub.nextBillingAt > now)
      return { created: false, reason: "NOT_DUE" };
    if (sub.endAt && sub.nextBillingAt >= sub.endAt) {
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: "CLOSED",
          substate: sub.cancelAtEnd ? "CANCELLED" : null,
        },
      });
      await tx.subscriptionEvent.create({
        data: { subscriptionId: sub.id, action: "EXPIRED", actorId, data: {} },
      });
      await audit(tx, actorId, "SUBSCRIPTION_EXPIRED", sub.id);
      return { created: false, reason: "EXPIRED" };
    }
    const amendment = await tx.amendment.findFirst({
      where: {
        subscriptionId,
        appliedAt: null,
        effectiveAt: { lte: sub.nextBillingAt },
      },
      orderBy: { effectiveAt: "asc" },
    });
    if (amendment) {
      const change = amendment.payload as {
        planVersionId: string;
        quantity: number;
        unitPrice: string;
        description: string;
        snapshot: Prisma.InputJsonValue;
      };
      check(sub.items.length === 1, "Scheduled change requires one item");
      await tx.subscriptionEvent.create({
        data: {
          subscriptionId,
          action: "PLAN_CHANGED",
          actorId,
          data: json({
            previousItems: sub.items,
            change,
            effectiveAt: sub.nextBillingAt,
          }),
        },
      });
      await tx.subscriptionItem.update({
        where: { id: sub.items[0]!.id },
        data: change,
      });
      await tx.amendment.update({
        where: { id: amendment.id },
        data: { appliedAt: now },
      });
      sub = (await tx.subscription.findUnique({
        where: { id: subscriptionId },
        include,
      }))!;
    }
    await lock(tx, `credits:${sub.customerId}`);
    if (sub.discountId) await lock(tx, `discount:${sub.discountId}`);
    if (sub.discountId)
      sub.discount = await tx.discount.findUnique({
        where: { id: sub.discountId },
      });
    const existing = await tx.billingPeriod.findUnique({
      where: {
        subscriptionId_startAt: { subscriptionId, startAt: sub.nextBillingAt },
      },
      include: { invoice: true },
    });
    check(
      !existing,
      "Billing cursor points at an invoiced period; review ProofBill before proceeding",
      409,
    );
    const first = (await tx.invoice.count({ where: { subscriptionId } })) === 0;
    const endAt = nextBoundary(
      sub.nextBillingAt,
      sub.interval,
      sub.anchorDay,
      sub.timezone,
    );
    // Partial final periods require an explicitly approved adjustment, rather than an implicit full charge.
    check(
      !sub.endAt || sub.endAt >= endAt,
      "Expiry must align to a billing boundary; approve a final-period adjustment first",
      409,
    );
    const { input, result, usage, available } = await prepare(tx, sub, first);
    const period = await tx.billingPeriod.create({
      data: { subscriptionId, startAt: sub.nextBillingAt, endAt },
    });
    const snapshot = {
      input,
      expected: result,
      customer: {
        name: sub.customer.name,
        email: sub.customer.email,
        company: sub.customer.company,
        billingAddress: sub.customer.billingAddress,
        taxId: sub.customer.taxId,
      },
      period: {
        startAt: sub.nextBillingAt.toISOString(),
        endAt: endAt.toISOString(),
      },
      sourceItems: sub.items.map((i) => ({
        id: i.id,
        planVersionId: i.planVersionId,
        quantity: i.quantity,
        unitPrice: i.unitPrice.toString(),
        snapshot: i.snapshot,
      })),
      usageEventIds: usage.map((u) => u.eventId),
    };
    const invoice = await tx.invoice.create({
      data: {
        number: number("INV"),
        customerId: sub.customerId,
        subscriptionId,
        periodId: period.id,
        currency: sub.currency,
        issuedAt: now,
        dueAt: DateTime.fromJSDate(now)
          .plus({ days: sub.customer.paymentTerms })
          .toJSDate(),
        subtotal: result.subtotal,
        discountTotal: result.discountTotal,
        taxTotal: result.taxTotal,
        creditTotal: result.creditTotal,
        total: result.total,
        snapshot: json(snapshot),
        snapshotHash: digest(snapshot),
        lines: {
          create: result.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            subtotal: l.subtotal,
            discount: l.discount,
            tax: l.tax,
            total: l.total,
            details: json(l),
          })),
        },
      },
      include: { lines: true },
    });
    if (usage.length)
      await tx.usageEvent.updateMany({
        where: { id: { in: usage.map((u) => u.id) } },
        data: { invoiceId: invoice.id },
      });
    let remaining = D(result.creditTotal);
    for (const credit of available) {
      if (remaining.lte(0)) break;
      const amount = remaining.lt(credit.remaining)
        ? remaining
        : credit.remaining;
      await tx.creditApplication.create({
        data: {
          creditId: credit.id,
          invoiceId: invoice.id,
          amount: money(amount),
        },
      });
      remaining = remaining.minus(amount);
    }
    if (result.discountApplied && sub.discountId) {
      await tx.discount.update({
        where: { id: sub.discountId },
        data: { used: { increment: 1 } },
      });
      await tx.discountApplication.create({
        data: {
          discountId: sub.discountId,
          invoiceId: invoice.id,
          amount: result.discountTotal,
        },
      });
    }
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        nextBillingAt: endAt,
        substate: sub.substate === "TRIALING" ? null : sub.substate,
      },
    });
    await audit(tx, actorId, "INVOICE_GENERATED", invoice.id, {
      subscriptionId,
      periodId: period.id,
      expected: result.total,
    });
    return {
      created: true,
      invoiceId: invoice.id,
      number: invoice.number,
      total: invoice.total.toString(),
    };
  });
}
export async function catchUp(
  subscriptionId: string,
  now = new Date(),
  actorId = "worker",
  maximum = 12,
) {
  const results = [];
  for (let i = 0; i < maximum; i++) {
    const result = await billOne(subscriptionId, now, actorId);
    results.push(result);
    if (!result.created) break;
  }
  return results;
}
billing.get("/subscriptions/:id/preview", async (req, res) => {
  const sub = await db.subscription.findUnique({
    where: { id: String(req.params.id) },
    include,
  });
  check(sub, "Subscription not found", 404);
  own(req.actor, sub.customerId);
  const first =
    (await db.invoice.count({ where: { subscriptionId: sub.id } })) === 0;
  const preview = await transaction((tx) => prepare(tx, sub, first));
  const pending = await db.amendment.findFirst({
    where: { subscriptionId: sub.id, appliedAt: null },
  });
  res.json({
    nextBillingAt: sub.nextBillingAt,
    ...preview.result,
    input: preview.input,
    uncertainty: sub.items.some((i) =>
      D((i.snapshot as unknown as Contract).usageRate).gt(0),
    )
      ? "Only received usage is included. Future usage and late events change the estimate."
      : null,
    scheduledChange: pending,
    warning: pending
      ? "An amendment is pending; this estimate shows current terms until that amendment is applied at billing."
      : null,
  });
});
billing.post("/billing/run", allow("ADMIN", "FINANCE"), async (req, res) => {
  const { subscriptionId } = z
    .object({ subscriptionId: z.string().optional() })
    .strict()
    .parse(req.body);
  const due = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      nextBillingAt: { lte: new Date() },
      ...(subscriptionId ? { id: subscriptionId } : {}),
    },
    take: 100,
    orderBy: { nextBillingAt: "asc" },
  });
  const items = [];
  for (const sub of due) {
    const key = `bill:${sub.id}:${sub.nextBillingAt.toISOString()}`;
    items.push(
      await db.job.upsert({
        where: { key },
        create: { key, kind: "BILL", payload: { subscriptionId: sub.id } },
        update: {},
      }),
    );
  }
  await audit(db, req.actor.id, "BILLING_QUEUED", "billing", {
    count: items.length,
  });
  res.status(202).json({ queued: items.length, items });
});
billing.get("/billing/jobs", allow("ADMIN", "FINANCE"), async (req, res) => {
  const q = pageInput.parse(req.query),
    where = { key: { contains: q.search, mode: "insensitive" as const } };
  res.json({
    items: await db.job.findMany({
      where,
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { createdAt: "desc" },
      include: { runs: { take: 5, orderBy: { startedAt: "desc" } } },
    }),
    total: await db.job.count({ where }),
  });
});
billing.post(
  "/billing/jobs/:id/retry",
  allow("ADMIN", "FINANCE"),
  async (req, res) => {
    res.json(
      await transaction(async (tx) => {
        const job = await tx.job.findUnique({
          where: { id: String(req.params.id) },
        });
        check(
          job && ["DEAD", "FAILED"].includes(job.status),
          "Only failed jobs can be retried",
        );
        const item = await tx.job.update({
          where: { id: job.id },
          data: { status: "PENDING", availableAt: new Date(), attempts: 0 },
        });
        await audit(tx, req.actor.id, "JOB_RETRIED", job.id);
        return item;
      }),
    );
  },
);
