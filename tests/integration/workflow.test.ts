import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { account, fixture } from "../support.js";
import { db, transaction } from "../../apps/api/src/db.js";
import { billOne, catchUp } from "../../apps/api/src/modules/billing.js";
import { recordPayment } from "../../apps/api/src/modules/finance.js";
import {
  deliverNotification,
  processJob,
} from "../../apps/worker/src/processor.js";
import { config } from "../../apps/api/src/config.js";
import { D } from "../../packages/billing-engine/src/index.js";
let admin: Awaited<ReturnType<typeof account>>,
  finance: Awaited<ReturnType<typeof account>>,
  customer: Awaited<ReturnType<typeof account>>,
  sales: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  admin = await account("ADMIN");
  finance = await account("FINANCE");
  customer = await account("CUSTOMER");
  sales = await account("SALES");
});
describe("quote to cash against PostgreSQL", () => {
  it("accepts, activates, bills, issues, pays and reports a real agreement", async () => {
    const f = await fixture(admin, customer.customerId);
    const first = await billOne(f.sub.id);
    expect(first.created).toBe(true);
    expect(first.total).toBe("1000");
    const retry = await billOne(f.sub.id);
    expect(retry.created).toBe(false);
    await finance.post(`/invoices/${first.invoiceId}/confirm`, {}).expect(200);
    const invoice = await customer
      .get(`/invoices/${first.invoiceId}`)
      .expect(200);
    expect(invoice.body.snapshotIntact).toBe(true);
    await finance
      .post("/payments", {
        customerId: customer.customerId,
        reference: randomUUID(),
        amount: "400",
        currency: "INR",
        method: "BANK_TRANSFER",
        receivedAt: new Date().toISOString(),
        allocations: [{ invoiceId: first.invoiceId, amount: "400" }],
      })
      .expect(201);
    const partial = await customer
      .get(`/invoices/${first.invoiceId}`)
      .expect(200);
    expect(partial.body.paymentStatus).toBe("PARTIALLY_PAID");
    expect(partial.body.outstanding).toBe("600.00");
    await finance
      .post("/payments", {
        customerId: customer.customerId,
        reference: randomUUID(),
        amount: "600",
        currency: "INR",
        method: "BANK_TRANSFER",
        receivedAt: new Date().toISOString(),
        allocations: [{ invoiceId: first.invoiceId, amount: "600" }],
      })
      .expect(201);
    const paid = await customer.get(`/invoices/${first.invoiceId}`).expect(200);
    expect(paid.body.paymentStatus).toBe("PAID");
    expect(paid.body.billingStatus).toBe("CONFIRMED");
    const report = await customer.get("/reports/dashboard").expect(200);
    expect(D(report.body.collected as string).gte(1000)).toBe(true);
    expect(report.body.activeSubscriptions).toBeGreaterThan(0);
    const pdf = await customer
      .get(`/invoices/${first.invoiceId}/pdf`)
      .expect(200)
      .expect("Content-Type", /pdf/);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    const pause = await customer
      .post(`/subscriptions/${f.sub.id}/action`, { action: "pause" })
      .expect(200);
    expect(pause.body.status).toBe("PAUSED");
    await customer
      .post(`/subscriptions/${f.sub.id}/action`, { action: "resume" })
      .expect(200);
    await customer
      .post(`/subscriptions/${f.sub.id}/action`, { action: "renew" })
      .expect(200);
  });
  it("two workers cannot bill the same period twice", async () => {
    const f = await fixture(admin, customer.customerId);
    const results = await Promise.all([billOne(f.sub.id), billOne(f.sub.id)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(
      await db.invoice.count({ where: { subscriptionId: f.sub.id } }),
    ).toBe(1);
  });
  it("recovers missed daily occurrences with a bounded cursor", async () => {
    const f = await fixture(admin, customer.customerId, { interval: "DAILY" });
    const start = new Date(Date.now() - 3 * 86400000);
    await db.subscription.update({
      where: { id: f.sub.id },
      data: { startAt: start, nextBillingAt: start },
    });
    const result = await catchUp(f.sub.id, new Date(), "test", 2);
    expect(result.filter((r) => r.created)).toHaveLength(2);
    expect(
      (
        await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } })
      ).nextBillingAt.getTime(),
    ).toBe(start.getTime() + 2 * 86400000);
    await catchUp(f.sub.id);
    expect(
      await db.invoice.count({ where: { subscriptionId: f.sub.id } }),
    ).toBe(4);
  });
  it("accepted quotes and issued financial documents resist changes at the database layer", async () => {
    const f = await fixture(admin, customer.customerId);
    await expect(
      db.quote.update({
        where: { id: f.quote.id },
        data: { terms: "changed" },
      }),
    ).rejects.toThrow();
    const billed = await billOne(f.sub.id);
    await finance.post(`/invoices/${billed.invoiceId}/confirm`, {}).expect(200);
    await expect(
      db.invoice.update({
        where: { id: billed.invoiceId },
        data: { total: "1" },
      }),
    ).rejects.toThrow();
    await expect(
      db.invoiceLine.updateMany({
        where: { invoiceId: billed.invoiceId },
        data: { unitPrice: "1" },
      }),
    ).rejects.toThrow();
  });
  it("rolls back invoice operations and keeps audit history append-only", async () => {
    const before = await db.product.count();
    await expect(
      transaction(async (tx) => {
        await tx.product.create({
          data: { name: "rollback", salesPrice: "1" },
        });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await db.product.count()).toBe(before);
    const audit = await db.auditLog.findFirstOrThrow();
    await expect(
      db.auditLog.delete({ where: { id: audit.id } }),
    ).rejects.toThrow();
  });
  it("requires independent financial approval and applies granted credit atomically", async () => {
    const a = await finance
      .post("/adjustments", {
        customerId: customer.customerId,
        kind: "GRANT",
        amount: "125",
        currency: "INR",
        reason: "Integration test credit grant",
      })
      .expect(201);
    await finance
      .post(`/adjustments/${a.body.id}/decide`, { approve: true })
      .expect(403);
    await admin
      .post(`/adjustments/${a.body.id}/decide`, { approve: true })
      .expect(200);
    const f = await fixture(admin, customer.customerId);
    const i = await billOne(f.sub.id);
    expect(i.total).toBe("875");
    await admin
      .post(`/adjustments/${a.body.id}/decide`, { approve: true })
      .expect(400);
  });
  it("records usage once and consumes it in the next invoice", async () => {
    const f = await fixture(admin, customer.customerId, { usage: true });
    const meter = await db.usageMeter.upsert({
      where: { key: "test_meter" },
      create: { key: "test_meter", name: "Test API", unit: "calls" },
      update: {},
    });
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: f.sub.id },
    });
    const occurredAt = new Date(sub.startAt.getTime() + 1);
    const next = new Date(sub.startAt.getTime() + 1000);
    await db.subscription.update({
      where: { id: f.sub.id },
      data: { nextBillingAt: next },
    });
    const input = {
      eventId: randomUUID(),
      subscriptionId: f.sub.id,
      meterId: meter.id,
      quantity: "250",
      occurredAt: occurredAt.toISOString(),
    };
    await new Promise((r) => setTimeout(r, 5));
    await admin.post("/usage", input).expect(201);
    await admin.post("/usage", input).expect(201);
    const billed = await billOne(f.sub.id, new Date(next.getTime() + 1));
    expect(billed.total).toBe("1015");
    const events = await db.usageEvent.findMany({
      where: { subscriptionId: f.sub.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.invoiceId).toBe(billed.invoiceId);
  });
  it("uses durable idempotency keys for payment retries and rejects input changes", async () => {
    const key = randomUUID(),
      reference = randomUUID();
    const input = {
      customerId: customer.customerId,
      reference,
      amount: "10",
      currency: "INR" as const,
      method: "CASH" as const,
      receivedAt: new Date(),
      notes: "",
      allocations: [],
    };
    const actor = {
      id: finance.id,
      role: "FINANCE" as const,
      customerId: null,
    };
    const [a, b] = await Promise.all([
      recordPayment(input, actor, key),
      recordPayment(input, actor, key),
    ]);
    expect(a.id).toBe(b.id);
    await expect(
      recordPayment({ ...input, amount: "20" }, actor, key),
    ).rejects.toThrow("different input");
  });
  it("queues durable billing work and executes it", async () => {
    const f = await fixture(admin, customer.customerId);
    const r = await finance
      .post("/billing/run", { subscriptionId: f.sub.id })
      .expect(202);
    expect(r.body.queued).toBe(1);
    for (let i = 0; i < 20; i++) {
      await processJob();
      if (await db.invoice.findFirst({ where: { subscriptionId: f.sub.id } }))
        break;
    }
    expect(
      await db.invoice.count({ where: { subscriptionId: f.sub.id } }),
    ).toBe(1);
  });
  it("ProofBill finds an altered draft and refuses confirmation", async () => {
    const f = await fixture(admin, customer.customerId);
    const billed = await billOne(f.sub.id);
    await db.invoice.update({
      where: { id: billed.invoiceId },
      data: { total: "1001" },
    });
    const scan = await finance.post("/integrity/scan", {}).expect(200);
    expect(scan.body.detected).toBeGreaterThan(0);
    expect(
      await db.discrepancy.findFirst({
        where: { invoiceId: billed.invoiceId, kind: "OVERBILLED" },
      }),
    ).not.toBeNull();
    await finance.post(`/invoices/${billed.invoiceId}/confirm`, {}).expect(409);
  });
  it("corrects a discrepant draft only after independent approval and preserves before/after evidence", async () => {
    const f = await fixture(admin, customer.customerId),
      billed = await billOne(f.sub.id);
    await db.invoice.update({
      where: { id: billed.invoiceId },
      data: { total: "1100" },
    });
    await finance.post("/integrity/scan", {}).expect(200);
    const issue = await db.discrepancy.findFirstOrThrow({
      where: { invoiceId: billed.invoiceId, kind: "OVERBILLED" },
    });
    const request = await finance
      .post(`/integrity/${issue.id}/request-correction`, {
        reason: "Restore calculated agreement total after verification",
      })
      .expect(201);
    await finance
      .post(`/adjustments/${request.body.id}/decide`, { approve: true })
      .expect(403);
    await admin
      .post(`/adjustments/${request.body.id}/decide`, { approve: true })
      .expect(200);
    expect(
      (
        await db.invoice.findUniqueOrThrow({ where: { id: billed.invoiceId } })
      ).total.toString(),
    ).toBe("1000");
    await finance.post(`/invoices/${billed.invoiceId}/confirm`, {}).expect(200);
    const trail = await db.auditLog.findFirst({
      where: { target: billed.invoiceId, action: "DRAFT_INVOICE_CORRECTED" },
    });
    expect(trail).not.toBeNull();
    await finance
      .post(`/integrity/${issue.id}/review`, {
        action: "RESOLVE",
        reason: "Approved draft correction verified and invoice confirmed",
      })
      .expect(200);
  });
  it("delivers transactional outbox messages without blocking financial state", async () => {
    let sends = 0;
    for (let i = 0; i < 10; i++)
      if (
        !(await deliverNotification(async () => {
          sends++;
        }))
      )
        break;
    expect(sends).toBeGreaterThan(0);
    expect(
      await db.outbox.count({ where: { status: "SENT" } }),
    ).toBeGreaterThan(0);
  });
  it("sales can quote but cannot configure tax or receive payments", async () => {
    await sales.post("/taxes", {}).expect(403);
    await sales.post("/payments", {}).expect(403);
  });
});
// Keep native auth API in the exercised integration path, including logout revocation.
it("logs out and invalidates the session", async () => {
  const temp = await account("CUSTOMER");
  await temp.agent
    .post("/api/auth/sign-out")
    .set("Origin", config.WEB_ORIGIN)
    .send({})
    .expect(200);
  await temp.get("/me").expect(401);
});
