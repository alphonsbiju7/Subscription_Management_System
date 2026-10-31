import { Router } from "express";
import { z } from "zod";
import { db, transaction, audit, digest, json, lock } from "../db.js";
import { allow } from "../access.js";
import { check } from "../errors.js";
import {
  calculateBill,
  D,
  sum,
  nextBoundary,
  type BillInput,
} from "../../../../packages/billing-engine/src/index.js";
import { pageInput } from "../../../../packages/validation/src/index.js";
export const integrity = Router();
integrity.use("/integrity", allow("ADMIN", "FINANCE"));
export async function verifyBilling(actorId = "worker", cursor?: string) {
  let detected = 0;
  async function flag(
    key: string,
    kind: string,
    evidence: unknown,
    invoiceId?: string,
    severity = "HIGH",
  ) {
    const before = await db.discrepancy.findUnique({ where: { key } });
    if (!before) {
      await db.discrepancy.upsert({
        where: { key },
        create: { key, kind, severity, evidence: json(evidence), invoiceId },
        update: {},
      });
      detected++;
    }
  }
  const invoices = await db.invoice.findMany({
    take: 500,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    include: {
      lines: true,
      period: true,
      subscription: true,
      creditApplications: true,
      discountApplication: { include: { discount: true } },
    },
  });
  for (const invoice of invoices) {
    const snapshot = invoice.snapshot as {
      input: BillInput;
      period: { startAt: string; endAt: string };
    };
    if (digest(invoice.snapshot) !== invoice.snapshotHash)
      await flag(
        `${invoice.id}:snapshot`,
        "UNEXPECTED_ADJUSTMENT",
        { message: "Billing snapshot hash differs" },
        invoice.id,
      );
    try {
      const expected = calculateBill(snapshot.input),
        actual = invoice.total.toString();
      if (!D(actual).eq(expected.total))
        await flag(
          `${invoice.id}:total`,
          D(actual).lt(expected.total) ? "UNDERBILLED" : "OVERBILLED",
          { expected: expected.total, actual },
          invoice.id,
        );
      if (!D(invoice.taxTotal.toString()).eq(expected.taxTotal))
        await flag(
          `${invoice.id}:tax`,
          "INCORRECT_TAX",
          { expected: expected.taxTotal, actual: invoice.taxTotal.toString() },
          invoice.id,
        );
      if (!D(invoice.discountTotal.toString()).eq(expected.discountTotal))
        await flag(
          `${invoice.id}:discount`,
          "INVALID_DISCOUNT",
          {
            expected: expected.discountTotal,
            actual: invoice.discountTotal.toString(),
          },
          invoice.id,
        );
      if (invoice.lines.length !== expected.lines.length)
        await flag(
          `${invoice.id}:lines`,
          "INCORRECT_QUANTITY",
          {
            expectedLines: expected.lines.length,
            actualLines: invoice.lines.length,
          },
          invoice.id,
        );
      for (
        let i = 0;
        i < Math.min(invoice.lines.length, expected.lines.length);
        i++
      ) {
        const l = invoice.lines[i]!,
          e = expected.lines[i]!;
        if (!D(l.quantity.toString()).eq(e.quantity))
          await flag(
            `${invoice.id}:quantity:${l.id}`,
            "INCORRECT_QUANTITY",
            { expected: e.quantity, actual: l.quantity.toString() },
            invoice.id,
          );
        if (!D(l.unitPrice.toString()).eq(e.unitPrice))
          await flag(
            `${invoice.id}:price:${l.id}`,
            "INVALID_PRICE",
            { expected: e.unitPrice, actual: l.unitPrice.toString() },
            invoice.id,
          );
      }
      const discount = invoice.discountApplication?.discount;
      if (
        discount &&
        (invoice.period.startAt < discount.startsAt ||
          invoice.period.startAt >= discount.endsAt)
      )
        await flag(
          `${invoice.id}:expired`,
          "EXPIRED_DISCOUNT",
          { code: discount.code, period: invoice.period.startAt },
          invoice.id,
        );
      if (discount?.usageLimit && discount.used > discount.usageLimit)
        await flag(
          `${discount.id}:limit`,
          "DISCOUNT_LIMIT",
          { used: discount.used, limit: discount.usageLimit },
          invoice.id,
        );
      if (
        snapshot.period.startAt !== invoice.period.startAt.toISOString() ||
        snapshot.period.endAt !== invoice.period.endAt.toISOString()
      )
        await flag(
          `${invoice.id}:period`,
          "PERIOD_CHANGED",
          { snapshot: snapshot.period, actual: invoice.period },
          invoice.id,
        );
      if (
        !D(invoice.creditTotal.toString()).eq(
          sum(invoice.creditApplications.map((a) => a.amount.toString())),
        )
      )
        await flag(
          `${invoice.id}:credits`,
          "MISAPPLIED_CREDITS",
          {
            expected: invoice.creditTotal.toString(),
            applied: sum(
              invoice.creditApplications.map((a) => a.amount.toString()),
            ).toString(),
          },
          invoice.id,
        );
      if (
        invoice.subscription.endAt &&
        invoice.period.startAt >= invoice.subscription.endAt
      )
        await flag(
          `${invoice.id}:closure`,
          "BILLED_AFTER_CLOSURE",
          { endAt: invoice.subscription.endAt, period: invoice.period.startAt },
          invoice.id,
        );
    } catch {
      await flag(
        `${invoice.id}:invalid`,
        "INVALID_SNAPSHOT",
        { message: "Snapshot could not be recomputed" },
        invoice.id,
      );
    }
  }
  // Missing periods: bounded scan of active contracts without pause/resume history.
  const subs = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      events: { none: { action: { in: ["RESUME", "PAUSE"] } } },
    },
    take: 500,
    include: { periods: true, items: true },
  });
  for (const s of subs) {
    let at = new Date(s.startAt);
    const trialDays = Math.max(
      0,
      ...s.items.map((i) =>
        Number((i.snapshot as { trialDays?: number }).trialDays ?? 0),
      ),
    );
    at = new Date(at.getTime() + trialDays * 86400000);
    for (
      let i = 0;
      i < 120 &&
      at < new Date(Date.now() - 86400000) &&
      (!s.endAt || at < s.endAt);
      i++
    ) {
      if (!s.periods.some((p) => p.startAt.getTime() === at.getTime()))
        await flag(`${s.id}:${at.toISOString()}:missing`, "MISSING_INVOICE", {
          subscriptionId: s.id,
          subscriptionNumber: s.number,
          startAt: at.toISOString(),
        });
      at = nextBoundary(at, s.interval, s.anchorDay, s.timezone);
    }
  }
  const payments = await db.payment.findMany({
    take: 1000,
    include: { allocations: true, adjustments: true },
    orderBy: { createdAt: "desc" },
  });
  for (const p of payments) {
    const allocated = sum(p.allocations.map((a) => a.amount.toString())).plus(
      sum(
        p.adjustments
          .filter((a) => a.status === "APPROVED" && a.kind === "REFUND")
          .map((a) => a.amount.toString()),
      ),
    );
    if (!allocated.eq(p.amount.toString()))
      await flag(
        `${p.id}:allocation`,
        "UNRECONCILED_PAYMENT",
        {
          paymentId: p.id,
          amount: p.amount.toString(),
          allocated: allocated.toString(),
        },
        undefined,
        "MEDIUM",
      );
  }
  await audit(db, actorId, "PROOFBILL_SCAN", "integrity", {
    invoicesScanned: invoices.length,
    detected,
  });
  return {
    detected,
    scanned: invoices.length,
    nextCursor: invoices.length === 500 ? invoices.at(-1)!.id : null,
    coverage:
      "Invoice scans are cursor-paginated. Missing-period scans cover up to 500 active contracts and 120 periods per contract without pause/resume history; payment scans cover the latest 1,000 payments. Duplicate invoice/payment attempts are prevented by database constraints.",
  };
}
integrity.get("/integrity", async (req, res) => {
  const q = pageInput.parse(req.query),
    where = {
      kind: { contains: q.search, mode: "insensitive" as const },
      ...(q.status ? { status: q.status } : {}),
    };
  res.json({
    items: await db.discrepancy.findMany({
      where,
      include: { invoice: { select: { number: true, customerId: true } } },
      orderBy: { createdAt: "desc" },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    total: await db.discrepancy.count({ where }),
  });
});
integrity.post("/integrity/scan", async (req, res) => {
  const { cursor } = z
    .object({ cursor: z.string().optional() })
    .strict()
    .parse(req.body);
  res.json(await verifyBilling(req.actor.id, cursor));
});
integrity.post("/integrity/:id/request-correction", async (req, res) => {
  const { reason } = z
    .object({ reason: z.string().min(8).max(2000) })
    .strict()
    .parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const finding = await tx.discrepancy.findUnique({
        where: { id: String(req.params.id) },
        include: { invoice: true },
      });
      check(
        finding?.invoice &&
          ["DETECTED", "UNDER_REVIEW"].includes(finding.status),
        "Reviewable invoice discrepancy required",
      );
      await lock(tx, `invoice:${finding.invoice.id}`);
      const invoice = finding.invoice;
      check(
        invoice.status === "DRAFT" &&
          digest(invoice.snapshot) === invoice.snapshotHash,
        "Automatic correction requires an unissued draft and an intact agreement snapshot",
      );
      const expected = calculateBill(
          (invoice.snapshot as { input: BillInput }).input,
        ),
        amount = D(invoice.total.toString()).minus(expected.total).abs();
      check(amount.gt(0), "No total difference to correct");
      check(
        !(await tx.adjustment.findFirst({
          where: {
            invoiceId: invoice.id,
            kind: "DRAFT_CORRECTION",
            status: "REQUESTED",
          },
        })),
        "Correction already awaiting approval",
      );
      const adjustment = await tx.adjustment.create({
        data: {
          customerId: invoice.customerId,
          invoiceId: invoice.id,
          kind: "DRAFT_CORRECTION",
          amount: amount.toFixed(2),
          currency: invoice.currency,
          reason,
          requestedBy: req.actor.id,
        },
      });
      await tx.discrepancy.update({
        where: { id: finding.id },
        data: { status: "UNDER_REVIEW", reviewedBy: req.actor.id, reason },
      });
      await audit(tx, req.actor.id, "DRAFT_CORRECTION_REQUESTED", invoice.id, {
        discrepancyId: finding.id,
        adjustmentId: adjustment.id,
        before: invoice.total.toString(),
        expected: expected.total,
        reason,
      });
      return adjustment;
    }),
  );
});
integrity.post("/integrity/:id/review", async (req, res) => {
  const input = z
    .object({
      action: z.enum(["REVIEW", "DISMISS", "CORRECTED", "RESOLVE"]),
      reason: z.string().min(8).max(2000),
      adjustmentId: z.string().optional(),
    })
    .strict()
    .parse(req.body);
  res.json(
    await transaction(async (tx) => {
      const item = await tx.discrepancy.findUnique({
        where: { id: String(req.params.id) },
        include: { invoice: true },
      });
      check(item, "Discrepancy not found", 404);
      const map = {
        REVIEW: "UNDER_REVIEW",
        DISMISS: "DISMISSED",
        CORRECTED: "CORRECTED",
        RESOLVE: "RESOLVED",
      };
      if (input.action === "CORRECTED") {
        check(
          item.status === "UNDER_REVIEW" && input.adjustmentId && item.invoice,
          "Review the discrepancy and provide an approved adjustment",
        );
        const adjustment = await tx.adjustment.findUnique({
          where: { id: input.adjustmentId },
        });
        check(
          adjustment?.status === "APPROVED" &&
            adjustment.customerId === item.invoice.customerId,
          "Approved adjustment for this customer required",
        );
      } else if (input.action === "RESOLVE")
        check(
          ["CORRECTED", "DISMISSED"].includes(item.status),
          "A correction or dismissal is required before resolution",
        );
      else
        check(
          ["DETECTED", "UNDER_REVIEW"].includes(item.status),
          "Discrepancy cannot be reviewed in this state",
        );
      const result = await tx.discrepancy.update({
        where: { id: item.id },
        data: {
          status: map[input.action],
          reason: input.reason,
          reviewedBy: req.actor.id,
          ...(input.action === "RESOLVE" ? { resolvedAt: new Date() } : {}),
        },
      });
      await audit(
        tx,
        req.actor.id,
        `DISCREPANCY_${input.action}`,
        item.id,
        input,
      );
      return result;
    }),
  );
});
