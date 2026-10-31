import { Decimal } from "decimal.js";
import { DateTime } from "luxon";
import type { Interval } from "../../shared-types/src/index.js";
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const D = (v: Decimal.Value) => new Decimal(v);
export const money = (v: Decimal.Value) =>
  D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const sum = (values: Decimal.Value[]) =>
  values.reduce<Decimal>((s, v) => s.plus(v), D(0));
export type Tier = { upTo: number | null; price: string };
export type Price = {
  model: string;
  unitPrice: string;
  quantity: string;
  tiers?: Tier[];
  packageSize?: number;
};
export function priceCharge(p: Price): string {
  const q = D(p.quantity),
    unit = D(p.unitPrice);
  if (q.lt(0) || unit.lt(0)) throw new Error("Negative pricing input");
  switch (p.model) {
    case "FLAT":
    case "HYBRID":
      return money(unit);
    case "USAGE":
      return "0.00";
    case "PER_SEAT":
    case "QUANTITY":
      return money(unit.mul(q));
    case "PACKAGE": {
      if (!p.packageSize || p.packageSize < 1)
        throw new Error("Package size must be positive");
      return money(q.div(p.packageSize).ceil().mul(unit));
    }
    case "VOLUME": {
      const tier = p.tiers?.find((t) => t.upTo === null || q.lte(t.upTo));
      if (!tier) throw new Error("Uncovered volume tier");
      return money(q.mul(tier.price));
    }
    case "TIERED": {
      let previous = D(0),
        charge = D(0),
        remaining = q;
      for (const tier of p.tiers ?? []) {
        const units =
          tier.upTo === null
            ? remaining
            : Decimal.min(remaining, D(tier.upTo).minus(previous));
        if (units.lt(0)) throw new Error("Tiers must be increasing");
        charge = charge.plus(units.mul(tier.price));
        remaining = remaining.minus(units);
        if (remaining.isZero()) return money(charge);
        if (tier.upTo !== null) previous = D(tier.upTo);
      }
      if (remaining.gt(0)) throw new Error("Uncovered pricing tier");
      return money(charge);
    }
    default:
      throw new Error("Unsupported pricing model");
  }
}
export type DiscountRule = {
  type: string;
  value: string;
  startsAt: string;
  endsAt: string;
  minimum: string;
  minQuantity: number;
  used: number;
  usageLimit: number | null;
  active: boolean;
};
export type TaxRule = {
  name: string;
  components: { name: string; rate: string }[];
  inclusive: boolean;
  startsAt?: string;
  endsAt?: string | null;
  active?: boolean;
};
export type InputLine = Price & {
  description: string;
  productId?: string;
  discountEligible?: boolean;
  tax?: TaxRule | null;
  extra?: string;
  sourceId?: string;
};
export type BillInput = {
  at: string;
  lines: InputLine[];
  discount?: DiscountRule | null;
  taxExempt?: boolean;
  credit?: string;
};
export type CalculatedLine = {
  description: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  components: { name: string; rate: string; amount: string }[];
  calculation: string;
};
export function calculateBill(input: BillInput) {
  const at = new Date(input.at);
  if (!Number.isFinite(at.getTime()) || !input.lines.length)
    throw new Error("Invalid bill input");
  const bases = input.lines.map((l) =>
    D(priceCharge(l))
      .plus(l.extra ?? "0")
      .toDecimalPlaces(2),
  );
  const eligible = sum(
    bases.filter((_, i) => input.lines[i]?.discountEligible !== false),
  );
  const quantity = sum(
    input.lines
      .filter((l) => l.discountEligible !== false)
      .map((l) => l.quantity),
  );
  const rule = input.discount;
  const discountEligible =
    !!rule &&
    rule.active &&
    at >= new Date(rule.startsAt) &&
    at < new Date(rule.endsAt) &&
    eligible.gte(rule.minimum) &&
    quantity.gte(rule.minQuantity) &&
    (rule.usageLimit === null || rule.used < rule.usageLimit);
  const discount = discountEligible
    ? Decimal.min(
        eligible,
        rule.type === "PERCENT"
          ? eligible.mul(rule.value).div(100)
          : D(rule.value),
      ).toDecimalPlaces(2)
    : D(0);
  const shares = bases.map((base, i) =>
    input.lines[i]?.discountEligible !== false && eligible.gt(0)
      ? discount.mul(base).div(eligible).toDecimalPlaces(2, Decimal.ROUND_DOWN)
      : D(0),
  );
  let cents = discount.minus(sum(shares)).mul(100).toNumber();
  const remainderOrder = bases
    .map((base, i) => ({
      i,
      fraction:
        input.lines[i]?.discountEligible !== false && eligible.gt(0)
          ? discount.mul(base).div(eligible).minus(shares[i]!)
          : D(-1),
    }))
    .sort((a, b) => b.fraction.cmp(a.fraction) || a.i - b.i);
  for (const { i } of remainderOrder) {
    if (cents <= 0) break;
    if (
      input.lines[i]?.discountEligible !== false &&
      shares[i]!.plus("0.01").lte(bases[i]!)
    ) {
      shares[i] = shares[i]!.plus("0.01");
      cents--;
    }
  }
  let allocated = D(0);
  const lines: CalculatedLine[] = input.lines.map((line, i) => {
    const base = bases[i]!;
    const off = shares[i]!;
    allocated = allocated.plus(off);
    const after = base.minus(off);
    const tax = line.tax;
    const valid =
      tax &&
      tax.active !== false &&
      !input.taxExempt &&
      (!tax.startsAt || at >= new Date(tax.startsAt)) &&
      (!tax.endsAt || at < new Date(tax.endsAt));
    const rate = valid ? sum(tax.components.map((c) => c.rate)) : D(0);
    const net =
      valid && tax.inclusive
        ? after.div(rate.div(100).plus(1)).toDecimalPlaces(2)
        : after;
    const components = valid
      ? tax.components.map((c) => ({
          ...c,
          amount: money(net.mul(c.rate).div(100)),
        }))
      : [];
    let totalTax = sum(components.map((c) => c.amount));
    if (valid && tax.inclusive && components.length) {
      const residual = after.minus(net).minus(totalTax);
      components[components.length - 1]!.amount = money(
        D(components.at(-1)!.amount).plus(residual),
      );
      totalTax = after.minus(net);
    }
    return {
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: money(base),
      discount: money(off),
      tax: money(totalTax),
      total: money(net.plus(totalTax)),
      components,
      calculation: `${line.model}: ${line.quantity} × ${line.unitPrice}; extra ${line.extra ?? "0"}; discount ${money(off)}; ${valid && tax.inclusive ? "inclusive" : "exclusive"} tax ${money(totalTax)}`,
    };
  });
  const beforeCredit = sum(lines.map((l) => l.total));
  const credit = Decimal.min(beforeCredit, D(input.credit ?? 0));
  if (credit.lt(0)) throw new Error("Negative credit");
  return {
    lines,
    subtotal: money(sum(lines.map((l) => l.subtotal))),
    discountTotal: money(allocated),
    taxTotal: money(sum(lines.map((l) => l.tax))),
    creditTotal: money(credit),
    total: money(beforeCredit.minus(credit)),
    discountApplied: discountEligible && allocated.gt(0),
  };
}
/** Periods are [start,end), local-calendar anchored, persisted as UTC instants. */
export function nextBoundary(
  start: Date,
  interval: Interval,
  anchorDay: number,
  zone = "Asia/Kolkata",
): Date {
  const dt = DateTime.fromJSDate(start, { zone });
  if (!dt.isValid || anchorDay < 1 || anchorDay > 31)
    throw new Error("Invalid billing calendar");
  let next: DateTime;
  switch (interval) {
    case "DAILY":
      next = dt.plus({ days: 1 });
      break;
    case "WEEKLY":
      next = dt.plus({ weeks: 1 });
      break;
    case "MONTHLY": {
      const target = dt.startOf("month").plus({ months: 1 });
      next = dt
        .plus({ months: 1 })
        .set({ day: Math.min(anchorDay, target.daysInMonth!) });
      break;
    }
    case "YEARLY": {
      const target = dt.plus({ years: 1 });
      next = target.set({ day: Math.min(anchorDay, target.daysInMonth!) });
      break;
    }
  }
  return next.toUTC().toJSDate();
}
export function proration(
  previous: string,
  next: string,
  start: Date,
  end: Date,
  changeAt: Date,
) {
  const length = end.getTime() - start.getTime();
  if (length <= 0 || changeAt < start || changeAt > end)
    throw new Error("Change outside billing period");
  const remaining = end.getTime() - changeAt.getTime(),
    fraction = D(remaining).div(length);
  const credit = D(previous).mul(fraction),
    charge = D(next).mul(fraction);
  return {
    previousCharge: money(previous),
    unusedCredit: money(credit),
    newCharge: money(charge),
    remainingMilliseconds: remaining,
    periodMilliseconds: length,
    finalAdjustment: money(charge.minus(credit)),
    policy: "UTC elapsed time, half-up rounding at document boundary",
  };
}
export function paymentState(
  total: string,
  paid: string,
  due: Date,
  now = new Date(),
) {
  const balance = D(total).minus(paid);
  return {
    outstanding: money(balance),
    paymentStatus: balance.lte(0)
      ? "PAID"
      : D(paid).gt(0)
        ? "PARTIALLY_PAID"
        : "UNPAID",
    overdue: balance.gt(0) && due < now,
  };
}
export const transitions: Record<string, string[]> = {
  DRAFT: ["QUOTATION"],
  QUOTATION: ["CONFIRMED", "CLOSED"],
  CONFIRMED: ["ACTIVE", "CLOSED"],
  ACTIVE: ["PAUSED", "CLOSED"],
  PAUSED: ["ACTIVE", "CLOSED"],
  CLOSED: [],
};
export function assertTransition(from: string, to: string) {
  if (!transitions[from]?.includes(to))
    throw new Error(`Cannot transition ${from} to ${to}`);
}
export function normalizedMRR(amount: string, interval: Interval) {
  const factors = {
    DAILY: D(365).div(12),
    WEEKLY: D(52).div(12),
    MONTHLY: D(1),
    YEARLY: D(1).div(12),
  };
  return D(amount).mul(factors[interval]);
}
