import { Router } from "express";
import { z } from "zod";
import { DateTime } from "luxon";
import {
  db,
  transaction,
  lock,
  audit,
  outbox,
  number,
  json,
  type Tx,
} from "../db.js";
import { allow, own, customerScope } from "../access.js";
import { check, ApiError } from "../errors.js";
import {
  quoteInput,
  pageInput,
  date,
  id,
} from "../../../../packages/validation/src/index.js";
import {
  D,
  calculateBill,
  assertTransition,
  proration,
  type InputLine,
  type TaxRule,
  type Tier,
} from "../../../../packages/billing-engine/src/index.js";
import type { Prisma, PlanVersion, Tax, Plan } from "@prisma/client";

export type Contract = {
  model: string;
  tiers: Tier[];
  packageSize: number;
  setupFee: string;
  addonCharge: string;
  includedUsage: string;
  usageRate: string;
  entitlements: Record<string, unknown>;
  tax: TaxRule | null;
  productId: string;
  version: number;
  canPause: boolean;
  canCancel: boolean;
  trialDays: number;
};
export function contract(
  version: PlanVersion & { tax: Tax | null },
  addonCharge = "0",
): Contract {
  return {
    model: version.pricingModel,
    tiers: version.tiers as Tier[],
    packageSize: version.packageSize,
    setupFee: version.setupFee.toString(),
    addonCharge,
    includedUsage: version.includedUsage.toString(),
    usageRate: version.usageRate.toString(),
    entitlements: version.entitlements as Record<string, unknown>,
    tax: version.tax
      ? {
          name: version.tax.name,
          components: version.tax.components as TaxRule["components"],
          inclusive: version.tax.inclusive,
          startsAt: version.tax.startsAt.toISOString(),
          endsAt: version.tax.endsAt?.toISOString(),
          active: version.tax.active,
        }
      : null,
    productId: version.planId,
    version: version.version,
    canPause: version.canPause,
    canCancel: version.canCancel,
    trialDays: version.trialDays,
  };
}
export const sales = Router();
sales.get("/quote-templates", allow("ADMIN", "SALES"), async (req, res) => {
  const q = pageInput.parse(req.query),
    where = { name: { contains: q.search, mode: "insensitive" as const } };
  res.json({
    items: await db.quoteTemplate.findMany({
      where,
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { name: "asc" },
    }),
    total: await db.quoteTemplate.count({ where }),
  });
});
sales.post("/quote-templates", allow("ADMIN"), async (req, res) => {
  const input = z
    .object({
      name: z.string().min(2).max(100),
      terms: z.string().max(8000),
      validityDays: z.number().int().min(1).max(365).default(30),
    })
    .strict()
    .parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const item = await tx.quoteTemplate.create({ data: input });
      await audit(tx, req.actor.id, "QUOTE_TEMPLATE_CREATED", item.id);
      return item;
    }),
  );
});
sales.get("/quotes", async (req, res) => {
  const q = pageInput.parse(req.query),
    where: Prisma.QuoteWhereInput = {
      ...customerScope(req.actor),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.status
        ? {
            status: z
              .enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"])
              .parse(q.status),
          }
        : {}),
      number: { contains: q.search, mode: "insensitive" },
    };
  if (req.actor.role === "CUSTOMER")
    where.customerId = req.actor.customerId ?? "__none__";
  const [items, total] = await Promise.all([
    db.quote.findMany({
      where,
      include: {
        customer: true,
        lines: true,
        subscriptions: { select: { id: true, number: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.quote.count({ where }),
  ]);
  res.json({
    items: items.map((q) => ({
      ...q,
      displayStatus:
        q.status === "SENT" && q.validUntil < new Date() ? "EXPIRED" : q.status,
    })),
    total,
  });
});
export async function createQuote(
  tx: Tx,
  input: z.infer<typeof quoteInput>,
  actorId: string,
) {
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
  });
  check(customer?.active, "Active customer required");
  check(
    input.validUntil > new Date(),
    "Quotation must have a future validity date",
  );
  const template = input.templateId
    ? await tx.quoteTemplate.findUnique({ where: { id: input.templateId } })
    : null;
  if (input.templateId) check(template, "Template not found");
  const versions = await tx.planVersion.findMany({
    where: { id: { in: input.lines.map((l) => l.planVersionId) } },
    include: { tax: true, plan: { include: { product: true } } },
  });
  const lineData = [];
  let interval: string | undefined;
  for (const line of input.lines) {
    const v = versions.find((v) => v.id === line.planVersionId);
    check(v?.plan.active && v.plan.product.active, "Available plan required");
    check(
      v.currency === customer.currency,
      "Customer and plan currencies must match",
    );
    check(line.quantity >= v.minQuantity, "Quantity below plan minimum");
    check(
      v.effectiveAt <= new Date() &&
        (!v.availableUntil || v.availableUntil > new Date()),
      "Plan unavailable",
    );
    if (interval)
      check(
        interval === v.interval,
        "All lines must use the same billing frequency",
      );
    interval = v.interval;
    const variant = line.variantId
      ? await tx.variant.findUnique({ where: { id: line.variantId } })
      : null;
    if (line.variantId)
      check(
        variant?.active && variant.productId === v.plan.productId,
        "Invalid product variant",
      );
    const addons = await tx.addon.findMany({
      where: {
        id: { in: line.addonIds },
        productId: v.plan.productId,
        active: true,
      },
    });
    check(
      addons.length === new Set(line.addonIds).size,
      "Invalid add-on selection",
    );
    const addonCharge = addons
      .reduce((s, a) => s.plus(a.price.toString()), D(0))
      .mul(line.quantity)
      .toString();
    const snapshot = {
      ...contract(v, addonCharge),
      productId: v.plan.productId,
      variant: variant
        ? {
            id: variant.id,
            name: variant.name,
            adjustment: variant.priceAdjustment.toString(),
          }
        : null,
      addons: addons.map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price.toString(),
      })),
    };
    lineData.push({
      planVersionId: v.id,
      description: `${v.plan.product.name} · ${v.plan.name}${variant ? ` · ${variant.name}` : ""}`,
      quantity: line.quantity,
      unitPrice: D(line.negotiatedPrice ?? v.price.toString())
        .plus(variant?.priceAdjustment.toString() ?? "0")
        .toString(),
      variantId: line.variantId,
      snapshot: json(snapshot),
    });
  }
  if (input.discountId) {
    const d = await tx.discount.findUnique({ where: { id: input.discountId } });
    check(
      d?.active && (!d.customerId || d.customerId === customer.id),
      "Discount not eligible",
    );
  }
  const quote = await tx.quote.create({
    data: {
      number: number("QUO"),
      customerId: customer.id,
      currency: customer.currency,
      validUntil: input.validUntil,
      terms: input.terms ?? template?.terms ?? "",
      discountId: input.discountId,
      lines: { create: lineData },
    },
    include: { lines: true },
  });
  await audit(tx, actorId, "QUOTE_CREATED", quote.id);
  return quote;
}
sales.post("/quotes", allow("ADMIN", "SALES"), async (req, res) => {
  const input = quoteInput.parse(req.body);
  if (input.lines.some((l) => l.negotiatedPrice))
    check(
      req.actor.role === "ADMIN",
      "Negotiated prices require administrator authorization",
      403,
    );
  res
    .status(201)
    .json(await transaction((tx) => createQuote(tx, input, req.actor.id)));
});
sales.get("/quotes/:id", async (req, res) => {
  const quote = await db.quote.findUnique({
    where: { id: String(req.params.id) },
    include: {
      lines: true,
      customer: true,
      discount: true,
      subscriptions: true,
    },
  });
  check(quote, "Quotation not found", 404);
  own(req.actor, quote.customerId);
  const lines: InputLine[] = quote.lines.map((l) => {
    const c = l.snapshot as unknown as Contract;
    return {
      description: l.description,
      model: c.model,
      quantity: String(l.quantity),
      unitPrice: l.unitPrice.toString(),
      tiers: c.tiers,
      packageSize: c.packageSize,
      extra: D(c.addonCharge).plus(c.setupFee).toString(),
      tax: c.tax,
      discountEligible:
        !quote.discount?.productId || quote.discount.productId === c.productId,
    };
  });
  const d = quote.discount;
  const preview = calculateBill({
    at: new Date().toISOString(),
    lines,
    taxExempt: quote.customer.taxExempt,
    discount: d
      ? {
          ...d,
          value: d.value.toString(),
          minimum: d.minimum.toString(),
          startsAt: d.startsAt.toISOString(),
          endsAt: d.endsAt.toISOString(),
        }
      : null,
  });
  res.json({ ...quote, preview });
});
sales.post("/quotes/:id/send", allow("ADMIN", "SALES"), async (req, res) =>
  res.json(
    await transaction(async (tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: String(req.params.id) },
        include: { customer: true },
      });
      check(
        quote?.status === "DRAFT" && quote.validUntil > new Date(),
        "Only valid draft quotations can be sent",
      );
      const item = await tx.quote.update({
        where: { id: quote.id },
        data: { status: "SENT" },
      });
      await outbox(
        tx,
        `quote:${quote.id}`,
        quote.customer.email,
        `Your Brightloop quotation ${quote.number}`,
        {
          text: `Review quotation ${quote.number} in your Brightloop portal. Valid until ${quote.validUntil.toISOString()}.`,
        },
      );
      await audit(tx, req.actor.id, "QUOTE_SENT", quote.id);
      return item;
    }),
  ),
);
sales.post("/quotes/:id/accept", allow("ADMIN", "CUSTOMER"), async (req, res) =>
  res.json(
    await transaction(async (tx) => {
      await lock(tx, `quote:${req.params.id}`);
      const quote = await tx.quote.findUnique({
        where: { id: String(req.params.id) },
        include: {
          customer: true,
          lines: { include: { planVersion: true } },
          subscriptions: true,
        },
      });
      check(quote, "Quotation not found", 404);
      own(req.actor, quote.customerId);
      if (quote.status === "ACCEPTED") return quote.subscriptions[0];
      check(
        quote.status === "SENT" &&
          quote.validUntil > new Date() &&
          quote.validFrom <= new Date(),
        "Quotation is not eligible for acceptance",
      );
      const first = quote.lines[0];
      check(first, "Quotation has no lines");
      const start = new Date();
      const sub = await tx.subscription.create({
        data: {
          number: number("SUB"),
          quoteId: quote.id,
          customerId: quote.customerId,
          status: "CONFIRMED",
          currency: quote.currency,
          interval: first.planVersion.interval,
          startAt: start,
          nextBillingAt: start,
          anchorDay: DateTime.fromJSDate(start, { zone: "Asia/Kolkata" }).day,
          autoRenew: first.planVersion.autoRenew,
          discountId: quote.discountId,
          items: {
            create: quote.lines.map((l) => ({
              planVersionId: l.planVersionId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              snapshot: l.snapshot as Prisma.InputJsonValue,
            })),
          },
          events: {
            create: [
              {
                action: "DRAFT → QUOTATION",
                actorId: req.actor.id,
                data: { quoteId: quote.id },
              },
              {
                action: "QUOTATION → CONFIRMED",
                actorId: req.actor.id,
                data: { quoteId: quote.id },
              },
            ],
          },
        },
      });
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "ACCEPTED", acceptedAt: start },
      });
      await audit(tx, req.actor.id, "QUOTE_ACCEPTED", quote.id, {
        subscriptionId: sub.id,
      });
      return sub;
    }),
  ),
);
sales.post("/quotes/:id/reject", allow("ADMIN", "CUSTOMER"), async (req, res) =>
  res.json(
    await transaction(async (tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: String(req.params.id) },
      });
      check(quote, "Quotation not found", 404);
      own(req.actor, quote.customerId);
      check(quote.status === "SENT", "Only sent quotations can be rejected");
      const result = await tx.quote.update({
        where: { id: quote.id },
        data: { status: "REJECTED" },
      });
      await audit(tx, req.actor.id, "QUOTE_REJECTED", quote.id);
      return result;
    }),
  ),
);
sales.post("/quotes/:id/revise", allow("ADMIN", "SALES"), async (req, res) => {
  const input = quoteInput.parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const original = await tx.quote.findUnique({
        where: { id: String(req.params.id) },
      });
      check(
        original && original.customerId === input.customerId,
        "Quotation not found",
        404,
      );
      if (input.lines.some((l) => l.negotiatedPrice))
        check(
          req.actor.role === "ADMIN",
          "Negotiated prices require administrator authorization",
          403,
        );
      const quote = await createQuote(tx, input, req.actor.id);
      return tx.quote.update({
        where: { id: quote.id },
        data: { previousId: original.id, revision: original.revision + 1 },
      });
    }),
  );
});
sales.get("/subscriptions", async (req, res) => {
  const q = pageInput.parse(req.query),
    where: Prisma.SubscriptionWhereInput = {
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...customerScope(req.actor),
      ...(q.status
        ? {
            status: z
              .enum([
                "DRAFT",
                "QUOTATION",
                "CONFIRMED",
                "ACTIVE",
                "PAUSED",
                "CLOSED",
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
      number: { contains: q.search, mode: "insensitive" },
    };
  const [items, total] = await Promise.all([
    db.subscription.findMany({
      where,
      include: { customer: true, items: true },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.subscription.count({ where }),
  ]);
  res.json({ items, total });
});
sales.get("/subscriptions/:id", async (req, res) => {
  const item = await db.subscription.findUnique({
    where: { id: String(req.params.id) },
    include: {
      customer: true,
      items: { include: { planVersion: { include: { plan: true } } } },
      events: { orderBy: { createdAt: "desc" }, take: 100 },
      amendments: { orderBy: { createdAt: "desc" }, take: 100 },
      invoices: { take: 50, orderBy: { issuedAt: "desc" } },
    },
  });
  check(item, "Subscription not found", 404);
  own(req.actor, item.customerId);
  res.json(item);
});
sales.post(
  "/subscriptions/:id/action",
  allow("ADMIN", "SALES", "CUSTOMER"),
  async (req, res) => {
    const input = z
      .object({
        action: z.enum([
          "activate",
          "pause",
          "resume",
          "cancel",
          "close",
          "renew",
        ]),
        endAt: date.optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await transaction(async (tx) => {
        const id = String(req.params.id);
        await lock(tx, `subscription:${id}`);
        const sub = await tx.subscription.findUnique({
          where: { id },
          include: { items: true, customer: true },
        });
        check(sub, "Subscription not found", 404);
        own(req.actor, sub.customerId);
        check(sub.customer.active, "Customer is inactive");
        const contracts = sub.items.map(
          (i) => i.snapshot as unknown as Contract,
        );
        let data: Prisma.SubscriptionUpdateInput = {};
        if (input.action === "activate") {
          check(
            req.actor.role !== "CUSTOMER",
            "Staff must activate accepted subscriptions",
            403,
          );
          assertTransition(sub.status, "ACTIVE");
          const trialDays = Math.max(0, ...contracts.map((c) => c.trialDays));
          const startAt = new Date();
          data = {
            status: "ACTIVE",
            startAt,
            nextBillingAt: DateTime.fromJSDate(startAt)
              .plus({ days: trialDays })
              .toJSDate(),
            substate: trialDays ? "TRIALING" : null,
          };
        }
        if (input.action === "pause") {
          check(
            contracts.every((c) => c.canPause),
            "Plan does not allow pausing",
          );
          assertTransition(sub.status, "PAUSED");
          check(
            sub.nextBillingAt > new Date(),
            "Bill due periods before pausing",
          );
          data = { status: "PAUSED", substate: null };
        }
        if (input.action === "resume") {
          assertTransition(sub.status, "ACTIVE");
          const now = new Date(),
            due = sub.nextBillingAt > now ? sub.nextBillingAt : now;
          data = {
            status: "ACTIVE",
            nextBillingAt: due,
            anchorDay: DateTime.fromJSDate(due, { zone: sub.timezone }).day,
          };
        }
        if (input.action === "close") {
          check(
            req.actor.role !== "CUSTOMER",
            "Only staff may close a subscription",
            403,
          );
          assertTransition(sub.status, "CLOSED");
          check(
            sub.status !== "ACTIVE" || sub.nextBillingAt > new Date(),
            "Bill due periods before closing",
          );
          data = { status: "CLOSED", endAt: new Date(), substate: "CANCELLED" };
        }
        if (input.action === "cancel") {
          check(
            contracts.every((c) => c.canCancel),
            "Plan does not allow early cancellation",
          );
          check(
            ["ACTIVE", "PAUSED"].includes(sub.status),
            "Subscription cannot be cancelled",
          );
          data = {
            cancelAtEnd: true,
            endAt: sub.nextBillingAt,
            substate: "EXPIRING",
          };
        }
        if (input.action === "renew") {
          check(
            ["ACTIVE", "PAUSED"].includes(sub.status),
            "Closed agreements require a new quotation",
          );
          check(
            !input.endAt || input.endAt > sub.nextBillingAt,
            "Renewal end must follow next billing",
          );
          data = {
            cancelAtEnd: false,
            endAt: input.endAt ?? null,
            autoRenew: true,
            substate: null,
          };
        }
        const result = await tx.subscription.update({ where: { id }, data });
        await tx.subscriptionEvent.create({
          data: {
            subscriptionId: id,
            action: input.action.toUpperCase(),
            actorId: req.actor.id,
            data: json({
              before: sub.status,
              after: result.status,
              nextBillingAt: result.nextBillingAt,
            }),
          },
        });
        await audit(tx, req.actor.id, "SUBSCRIPTION_ACTION", id, input);
        await outbox(
          tx,
          `sub:${id}:${result.updatedAt.toISOString()}`,
          sub.customer.email,
          `Subscription ${input.action}`,
          { text: `${sub.number}: ${input.action} recorded.` },
        );
        return result;
      }),
    );
  },
);
sales.post(
  "/subscriptions/:id/change",
  allow("ADMIN", "SALES", "CUSTOMER"),
  async (req, res) => {
    const input = z
      .object({
        planVersionId: id,
        quantity: z.number().int().min(1).max(1000000),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(
      await transaction(async (tx) => {
        const id = String(req.params.id);
        await lock(tx, `subscription:${id}`);
        const sub = await tx.subscription.findUnique({
          where: { id },
          include: {
            items: { include: { planVersion: { include: { plan: true } } } },
          },
        });
        check(sub, "Subscription not found", 404);
        own(req.actor, sub.customerId);
        check(
          sub.status === "ACTIVE" && sub.items.length === 1 && !sub.cancelAtEnd,
          "Only active single-plan agreements support scheduled plan changes",
        );
        check(
          sub.nextBillingAt > new Date(),
          "Bill due periods before scheduling a change",
        );
        const version = await tx.planVersion.findUnique({
          where: { id: input.planVersionId },
          include: { plan: true, tax: true },
        });
        check(
          version?.plan.active &&
            version.effectiveAt <= sub.nextBillingAt &&
            (!version.availableUntil ||
              version.availableUntil > sub.nextBillingAt),
          "Available plan required",
        );
        check(
          version.currency === sub.currency &&
            version.interval === sub.interval &&
            version.plan.productId ===
              sub.items[0]!.planVersion.plan.productId &&
            input.quantity >= version.minQuantity,
          "Choose a compatible product, currency, interval and quantity",
        );
        check(
          !(await tx.amendment.findFirst({
            where: { subscriptionId: id, appliedAt: null },
          })),
          "A future change already exists",
        );
        const amendment = await tx.amendment.create({
          data: {
            subscriptionId: id,
            effectiveAt: sub.nextBillingAt,
            payload: json({
              ...input,
              unitPrice: version.price.toString(),
              description: version.plan.name,
              snapshot: {
                ...contract(version),
                productId: version.plan.productId,
              },
            }),
          },
        });
        await audit(tx, req.actor.id, "PLAN_CHANGE_SCHEDULED", id, amendment);
        return amendment;
      }),
    );
  },
);
sales.post(
  "/pricing/proration",
  allow("ADMIN", "SALES", "FINANCE"),
  async (req, res) => {
    const input = z
      .object({
        previous: z.string().regex(/^\d+(\.\d+)?$/),
        next: z.string().regex(/^\d+(\.\d+)?$/),
        start: date,
        end: date,
        changeAt: date,
      })
      .strict()
      .parse(req.body);
    try {
      res.json(
        proration(
          input.previous,
          input.next,
          input.start,
          input.end,
          input.changeAt,
        ),
      );
    } catch {
      throw new ApiError(400, "Invalid proration period");
    }
  },
);
export type VersionWithPlan = PlanVersion & { plan: Plan; tax: Tax | null };
