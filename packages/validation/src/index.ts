import { z } from "zod";
import { roles, intervals } from "../../shared-types/src/index.js";
export const money = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Use a positive decimal string");
export const cash = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,2})?$/,
    "Use a monetary amount with at most two decimal places",
  );
export const currency = z.enum(["INR", "USD", "EUR", "GBP"]);
export const id = z.string().min(1).max(100);
export const date = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v));
export const password = z
  .string()
  .min(9)
  .max(256)
  .regex(/[A-Z]/, "Include uppercase")
  .regex(/[a-z]/, "Include lowercase")
  .regex(/[^A-Za-z0-9\s]/, "Include a special character")
  .refine(
    (v) => !["Password123!", "Welcome123!", "Qwerty123!"].includes(v),
    "Choose an uncommon password",
  );
export const customerInput = z
  .object({
    name: z.string().trim().min(2).max(160),
    email: z.email().toLowerCase(),
    company: z.string().max(160).default(""),
    phone: z.string().max(40).default(""),
    billingAddress: z.string().max(1000).default(""),
    serviceAddress: z.string().max(1000).default(""),
    taxId: z.string().max(60).default(""),
    currency: currency.default("INR"),
    paymentTerms: z.number().int().min(0).max(365).default(14),
    taxExempt: z.boolean().default(false),
    notes: z.string().max(4000).default(""),
    active: z.boolean().default(true),
  })
  .strict();
export const productInput = z
  .object({
    name: z.string().min(2).max(160),
    description: z.string().max(4000).default(""),
    category: z.string().max(100).default("Software"),
    type: z.string().max(40).default("SERVICE"),
    salesPrice: money,
    costPrice: money.default("0"),
    currency: currency.default("INR"),
    active: z.boolean().default(true),
  })
  .strict();
export const variantInput = z
  .object({
    name: z.string().min(1).max(100),
    sku: z.string().min(1).max(80),
    priceAdjustment: money,
    active: z.boolean().default(true),
  })
  .strict();
export const tierInput = z.object({
  upTo: z.number().int().positive().nullable(),
  price: money,
});
export const planInput = z
  .object({
    productId: id,
    name: z.string().min(2).max(160),
    description: z.string().max(4000).default(""),
    currency: currency.default("INR"),
    interval: z.enum(intervals),
    price: money,
    pricingModel: z
      .enum([
        "FLAT",
        "PER_SEAT",
        "QUANTITY",
        "TIERED",
        "VOLUME",
        "PACKAGE",
        "USAGE",
        "HYBRID",
      ])
      .default("PER_SEAT"),
    tiers: z.array(tierInput).max(20).default([]),
    packageSize: z.number().int().min(1).max(1000000).default(1),
    setupFee: money.default("0"),
    minQuantity: z.number().int().min(1).max(1000000).default(1),
    trialDays: z.number().int().min(0).max(365).default(0),
    canPause: z.boolean().default(true),
    canCancel: z.boolean().default(true),
    autoRenew: z.boolean().default(true),
    taxId: id.optional(),
    includedUsage: money.default("0"),
    usageRate: money.default("0"),
    entitlements: z
      .record(z.string(), z.union([z.number(), z.boolean(), z.string()]))
      .default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (["TIERED", "VOLUME"].includes(v.pricingModel)) {
      if (
        !v.tiers.length ||
        v.tiers.at(-1)?.upTo !== null ||
        v.tiers.some(
          (t, i) =>
            i < v.tiers.length - 1 &&
            (t.upTo === null || t.upTo <= (v.tiers[i - 1]?.upTo ?? 0)),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Tiers must increase and end with an unlimited tier",
          path: ["tiers"],
        });
    }
  });
export const discountInput = z
  .object({
    code: z.string().trim().min(2).max(60).toUpperCase(),
    type: z.enum(["PERCENT", "FIXED"]),
    value: money,
    minimum: money.default("0"),
    minQuantity: z.number().int().min(1).default(1),
    startsAt: date,
    endsAt: date,
    usageLimit: z.number().int().positive().optional(),
    customerId: id.optional(),
    productId: id.optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.endsAt > v.startsAt, "End must follow start")
  .refine(
    (v) => v.type !== "PERCENT" || Number(v.value) <= 100,
    "Percentage cannot exceed 100",
  );
export const taxInput = z
  .object({
    name: z.string().min(2).max(100),
    components: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          rate: money.refine((v) => Number(v) <= 100),
        }),
      )
      .min(1)
      .max(10),
    inclusive: z.boolean().default(false),
    jurisdiction: z.string().max(80).default("IN"),
    startsAt: date,
    endsAt: date.optional(),
    active: z.boolean().default(true),
  })
  .strict();
export const quoteInput = z
  .object({
    customerId: id,
    templateId: id.optional(),
    validUntil: date,
    discountId: id.optional(),
    terms: z.string().max(8000).optional(),
    lines: z
      .array(
        z
          .object({
            planVersionId: id,
            quantity: z.number().int().min(1).max(1000000),
            variantId: id.optional(),
            addonIds: z.array(id).max(20).default([]),
            negotiatedPrice: money.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const paymentInput = z
  .object({
    customerId: id,
    reference: z.string().min(3).max(120),
    amount: cash,
    currency,
    method: z.enum(["BANK_TRANSFER", "CASH", "CHEQUE", "OTHER"]),
    receivedAt: date,
    notes: z.string().max(2000).default(""),
    allocations: z
      .array(z.object({ invoiceId: id, amount: cash }))
      .max(100)
      .default([]),
  })
  .strict();
export const invitationInput = z
  .object({
    email: z.email().toLowerCase(),
    role: z.enum(roles).exclude(["CUSTOMER"]),
  })
  .strict();
export const pageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(160).default(""),
  status: z.string().max(40).optional(),
  customerId: id.optional(),
  productId: id.optional(),
  planId: id.optional(),
  from: date.optional(),
  to: date.optional(),
});
