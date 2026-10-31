import { describe, expect, it } from "vitest";
import {
  D,
  calculateBill,
  nextBoundary,
  proration,
  priceCharge,
  normalizedMRR,
  assertTransition,
  paymentState,
} from "../../packages/billing-engine/src/index.js";
const line = {
  description: "CRM Odoo",
  model: "PER_SEAT",
  quantity: "3",
  unitPrice: "1560",
};
const tax = {
  name: "GST",
  inclusive: false,
  components: [
    { name: "CGST", rate: "9" },
    { name: "SGST", rate: "9" },
  ],
};
const discount = {
  type: "PERCENT",
  value: "10",
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2027-01-01T00:00:00Z",
  minimum: "0",
  minQuantity: 1,
  used: 0,
  usageLimit: 2,
  active: true,
};
describe("exact pricing", () => {
  it("preserves the Odoo increment and discounts before component taxes", () => {
    const b = calculateBill({
      at: "2026-10-01T00:00:00Z",
      lines: [{ ...line, tax }],
      discount,
    });
    expect(b.subtotal).toBe("4680.00");
    expect(b.discountTotal).toBe("468.00");
    expect(b.taxTotal).toBe("758.16");
    expect(b.total).toBe("4970.16");
    expect(b.lines[0]!.components.map((c) => c.amount)).toEqual([
      "379.08",
      "379.08",
    ]);
  });
  it("does not apply expired discounts at the exclusive boundary", () => {
    expect(
      calculateBill({ at: discount.endsAt, lines: [line], discount })
        .discountTotal,
    ).toBe("0.00");
  });
  it.each([
    { ...discount, used: 2 },
    { ...discount, active: false },
    { ...discount, minimum: "5000" },
    { ...discount, minQuantity: 4 },
  ])("rejects exhausted or ineligible discount %#", (d) => {
    expect(
      calculateBill({ at: "2026-10-01T00:00:00Z", lines: [line], discount: d })
        .discountTotal,
    ).toBe("0.00");
  });
  it("handles inclusive taxes without rounding loss", () => {
    const b = calculateBill({
      at: "2026-10-01T00:00:00Z",
      lines: [
        {
          ...line,
          quantity: "1",
          unitPrice: "118",
          tax: { ...tax, inclusive: true },
        },
      ],
    });
    expect(b.total).toBe("118.00");
    expect(b.taxTotal).toBe("18.00");
  });
  it("handles zero and tax exemption", () => {
    expect(
      calculateBill({
        at: "2026-10-01T00:00:00Z",
        lines: [{ ...line, tax }],
        taxExempt: true,
      }).taxTotal,
    ).toBe("0.00");
  });
  it("caps fixed discounts and credits at payable total", () => {
    const b = calculateBill({
      at: "2026-10-01T00:00:00Z",
      lines: [line],
      discount: { ...discount, type: "FIXED", value: "999999" },
      credit: "10",
    });
    expect(b.total).toBe("0.00");
    expect(b.creditTotal).toBe("0.00");
  });
  it("allocates invoice discounts across eligible lines deterministically", () => {
    const b = calculateBill({
      at: "2026-10-01T00:00:00Z",
      lines: [
        { ...line, quantity: "1", unitPrice: "0.05" },
        { ...line, quantity: "1", unitPrice: "0.05" },
        { ...line, quantity: "1", unitPrice: "0.05", discountEligible: false },
      ],
      discount: { ...discount, type: "FIXED", value: "0.03" },
    });
    expect(b.discountTotal).toBe("0.03");
    expect(b.lines.map((l) => l.discount)).toEqual(["0.02", "0.01", "0.00"]);
    expect(b.total).toBe("0.12");
  });
  it("avoids binary floating point errors", () => {
    expect(priceCharge({ ...line, quantity: "3", unitPrice: "0.1" })).toBe(
      "0.30",
    );
  });
  it("distributes small discounts without losing pennies", () => {
    const b = calculateBill({
      at: "2026-10-01T00:00:00Z",
      lines: Array.from({ length: 5 }, () => ({
        ...line,
        quantity: "1",
        unitPrice: "0.01",
      })),
      discount: { ...discount, type: "FIXED", value: "0.02" },
    });
    expect(b.discountTotal).toBe("0.02");
    expect(b.total).toBe("0.03");
  });
  it.each([
    ["FLAT", "19.00"],
    ["PER_SEAT", "190.00"],
    ["QUANTITY", "190.00"],
    ["PACKAGE", "57.00"],
    ["HYBRID", "19.00"],
    ["USAGE", "0.00"],
  ])("supports %s pricing", (model, expected) => {
    expect(
      priceCharge({ model, quantity: "10", unitPrice: "19", packageSize: 4 }),
    ).toBe(expected);
  });
  it("supports graduated and volume tiers", () => {
    const p = {
      quantity: "15",
      unitPrice: "0",
      tiers: [
        { upTo: 10, price: "5" },
        { upTo: null, price: "3" },
      ],
    };
    expect(priceCharge({ ...p, model: "TIERED" })).toBe("65.00");
    expect(priceCharge({ ...p, model: "VOLUME" })).toBe("45.00");
  });
  it("rejects uncovered or invalid pricing", () => {
    expect(() =>
      priceCharge({
        model: "PACKAGE",
        quantity: "1",
        unitPrice: "3",
        packageSize: 0,
      }),
    ).toThrow();
    expect(() =>
      priceCharge({
        model: "TIERED",
        quantity: "3",
        unitPrice: "0",
        tiers: [{ upTo: 1, price: "1" }],
      }),
    ).toThrow();
  });
});
describe("billing calendars", () => {
  it("restores the 31st after February", () => {
    const feb = nextBoundary(
      new Date("2026-01-31T00:00:00Z"),
      "MONTHLY",
      31,
      "UTC",
    );
    expect(feb.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(nextBoundary(feb, "MONTHLY", 31, "UTC").toISOString()).toBe(
      "2026-03-31T00:00:00.000Z",
    );
  });
  it("handles leap day yearly billing", () => {
    const d = nextBoundary(
      new Date("2024-02-29T00:00:00Z"),
      "YEARLY",
      29,
      "UTC",
    );
    expect(d.toISOString()).toBe("2025-02-28T00:00:00.000Z");
  });
  it.each([29, 30, 31])(
    "clamps January %s to February then restores anchor",
    (day) => {
      const feb = nextBoundary(
        new Date(`2024-01-${day}T00:00:00Z`),
        "MONTHLY",
        day,
        "UTC",
      );
      expect(feb.getUTCDate()).toBe(29);
      expect(nextBoundary(feb, "MONTHLY", day, "UTC").getUTCDate()).toBe(day);
    },
  );
  it("preserves local clock time across DST", () => {
    expect(
      nextBoundary(
        new Date("2026-03-07T14:00:00Z"),
        "DAILY",
        7,
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");
  });
  it("handles weekly and Kolkata schedules", () => {
    expect(
      nextBoundary(new Date("2026-10-01T03:30:00Z"), "WEEKLY", 1).toISOString(),
    ).toBe("2026-10-08T03:30:00.000Z");
  });
});
describe("lifecycle, proration and financial analytics", () => {
  it("enforces lifecycle progression", () => {
    expect(() => assertTransition("DRAFT", "ACTIVE")).toThrow();
    assertTransition("DRAFT", "QUOTATION");
    assertTransition("QUOTATION", "CONFIRMED");
    assertTransition("CONFIRMED", "ACTIVE");
    assertTransition("ACTIVE", "PAUSED");
    expect(() => assertTransition("CLOSED", "ACTIVE")).toThrow();
  });
  it("shows credit, charge and net adjustment", () => {
    const r = proration(
      "1000",
      "2000",
      new Date("2026-10-01"),
      new Date("2026-10-31"),
      new Date("2026-10-16"),
    );
    expect(r.unusedCredit).toBe("500.00");
    expect(r.newCharge).toBe("1000.00");
    expect(r.finalAdjustment).toBe("500.00");
  });
  it("handles proration start/end and leap-year periods", () => {
    const start = new Date("2024-02-01"),
      end = new Date("2024-03-01");
    expect(proration("29", "58", start, end, start).finalAdjustment).toBe(
      "29.00",
    );
    expect(proration("29", "58", start, end, end).finalAdjustment).toBe("0.00");
    expect(() => proration("1", "2", start, start, start)).toThrow();
  });
  it("calculates cash balances without changing invoice accounting status", () => {
    expect(paymentState("100", "25", new Date("2020-01-01"))).toEqual({
      outstanding: "75.00",
      paymentStatus: "PARTIALLY_PAID",
      overdue: true,
    });
    expect(
      paymentState("100", "100", new Date("2020-01-01")).paymentStatus,
    ).toBe("PAID");
  });
  it("normalizes MRR", () => {
    expect(normalizedMRR("1200", "YEARLY").eq(100)).toBe(true);
    expect(normalizedMRR("10", "DAILY").eq(D(3650).div(12))).toBe(true);
  });
});
