import { Router } from "express";
import { z } from "zod";
import { db, transaction, audit } from "../db.js";
import { allow, own, customerScope } from "../access.js";
import { check } from "../errors.js";
import { date, money } from "../../../../packages/validation/src/index.js";
import { D, sum } from "../../../../packages/billing-engine/src/index.js";
import type { Contract } from "./sales.js";
export const usage = Router();
usage.get("/usage/meters", async (_req, res) =>
  res.json({ items: await db.usageMeter.findMany({ take: 100 }) }),
);
usage.post("/usage/meters", allow("ADMIN"), async (req, res) => {
  const input = z
    .object({
      key: z.string().min(2).max(80),
      name: z.string().min(2).max(100),
      unit: z.string().min(1).max(40),
    })
    .strict()
    .parse(req.body);
  res.status(201).json(await db.usageMeter.create({ data: input }));
});
usage.get("/usage", async (req, res) => {
  const id = z.string().optional().parse(req.query.subscriptionId);
  if (id) {
    const sub = await db.subscription.findUnique({ where: { id } });
    check(sub, "Subscription not found", 404);
    own(req.actor, sub.customerId);
  }
  const items = await db.usageEvent.findMany({
    where: {
      ...(id ? { subscriptionId: id } : {}),
      subscription: customerScope(req.actor),
    },
    include: { meter: true, subscription: { select: { number: true } } },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });
  res.json({ items });
});
usage.post("/usage", allow("ADMIN"), async (req, res) => {
  const input = z
    .object({
      eventId: z.string().min(8).max(120),
      subscriptionId: z.string(),
      meterId: z.string(),
      quantity: money,
      occurredAt: date,
    })
    .strict()
    .parse(req.body);
  check(D(input.quantity).gt(0), "Usage quantity must be positive");
  check(input.occurredAt <= new Date(), "Future usage is not allowed");
  res.status(201).json(
    await transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id: input.subscriptionId },
        include: { items: true },
      });
      check(
        sub?.status === "ACTIVE" &&
          sub.items.length === 1 &&
          input.occurredAt >= sub.startAt,
        "Usage requires an active single-plan agreement and a valid service timestamp",
      );
      const contract = sub.items[0]!.snapshot as unknown as Contract;
      check(
        ["USAGE", "HYBRID"].includes(contract.model) &&
          D(contract.usageRate).gt(0),
        "Plan is not metered",
      );
      const previous = await tx.usageEvent.findUnique({
        where: { eventId: input.eventId },
      });
      if (previous) {
        check(
          previous.subscriptionId === input.subscriptionId &&
            previous.meterId === input.meterId &&
            previous.quantity.eq(input.quantity) &&
            previous.occurredAt.getTime() === input.occurredAt.getTime(),
          "Event ID reused with different data",
          409,
        );
        return previous;
      }
      const item = await tx.usageEvent.create({ data: input });
      await audit(tx, req.actor.id, "USAGE_RECORDED", item.id, {
        eventId: input.eventId,
      });
      return item;
    }),
  );
});
usage.get("/subscriptions/:id/entitlements", async (req, res) => {
  const sub = await db.subscription.findUnique({
    where: { id: String(req.params.id) },
    include: { items: true },
  });
  check(sub, "Subscription not found", 404);
  own(req.actor, sub.customerId);
  const aggregate = await db.usageEvent.aggregate({
    where: { subscriptionId: sub.id, invoiceId: null },
    _sum: { quantity: true },
  });
  const consumed = aggregate._sum.quantity?.toString() ?? "0";
  const contracts = sub.items.map((i) => i.snapshot as unknown as Contract);
  const included = sum(contracts.map((c) => c.includedUsage));
  res.json({
    active: sub.status === "ACTIVE",
    features: contracts.map((c) => c.entitlements),
    included: included.toString(),
    consumed,
    remaining: included.gt(consumed)
      ? included.minus(consumed).toString()
      : "0",
    decision:
      sub.status !== "ACTIVE"
        ? "SUSPENDED"
        : D(consumed).gt(included)
          ? "OVERAGE_BILLABLE"
          : "WITHIN_ALLOWANCE",
  });
});
