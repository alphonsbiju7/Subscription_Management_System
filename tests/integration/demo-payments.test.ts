import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { account, fixture } from "../support.js";
import { db } from "../../apps/api/src/db.js";
import { billOne } from "../../apps/api/src/modules/billing.js";
import { processPaymentRecovery } from "../../apps/api/src/modules/demo-payments.js";
import { processJob, queueReminders } from "../../apps/worker/src/processor.js";
import { config } from "../../apps/api/src/config.js";

type TestAccount = Awaited<ReturnType<typeof account>>;
let admin: TestAccount,
  finance: TestAccount,
  customer: TestAccount,
  other: TestAccount,
  sales: TestAccount;
beforeAll(async () => {
  admin = await account("ADMIN");
  finance = await account("FINANCE");
  customer = await account("CUSTOMER");
  other = await account("CUSTOMER");
  sales = await account("SALES");
});
async function invoice(overdue = false) {
  const f = await fixture(admin, customer.customerId);
  const billed = await billOne(f.sub.id);
  const id = billed.invoiceId!;
  if (overdue)
    await db.invoice.update({
      where: { id },
      data: { dueAt: new Date(Date.now() - 86_400_000) },
    });
  await finance.post(`/invoices/${id}/confirm`, {}).expect(200);
  return { id, subscriptionId: f.sub.id };
}
const checkout = (
  invoiceId: string,
  scenario = "SUCCESS",
  portion = "FULL",
) => ({ invoiceId, method: "UPI", scenario, portion });
const paymentRequest = (user: TestAccount, input: object, key: string) =>
  user.agent
    .post("/api/v1/payments/demo/checkout")
    .set("Origin", config.WEB_ORIGIN)
    .set("Idempotency-Key", key)
    .send(input);

describe("persisted demo checkout", () => {
  it("settles a full invoice through the existing ledger, receipt, and dashboard", async () => {
    const i = await invoice();
    const before = await customer.get("/reports/dashboard").expect(200);
    const response = await customer
      .post("/payments/demo/checkout", checkout(i.id))
      .expect(201);
    expect(response.body.outcome).toBe("SUCCESS");
    expect(response.body.mode).toBe("DEMO MODE");
    expect(response.body.transactionReference).toMatch(/^DEMO-/);
    expect(response.body.invoice.outstanding).toBe("0.00");
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: response.body.paymentId },
      include: { allocations: true },
    });
    expect(payment.method).toBe("DEMO_UPI");
    expect(payment.amount.toString()).toBe("1000");
    expect(payment.notes).toContain("DEMO MODE");
    expect(payment.allocations).toHaveLength(1);
    expect(payment.allocations[0]!.invoiceId).toBe(i.id);
    const view = await customer.get(`/invoices/${i.id}`).expect(200);
    expect(view.body.paymentStatus).toBe("PAID");
    expect(view.body.billingStatus).toBe("CONFIRMED");
    const after = await customer.get("/reports/dashboard").expect(200);
    expect(Number(after.body.collected) - Number(before.body.collected)).toBe(
      1000,
    );
    await customer
      .get(`/payments/demo/attempts/${response.body.id}`)
      .expect(200);
    const message = await db.outbox.findUniqueOrThrow({
      where: { key: `payment:${payment.id}` },
    });
    expect(message.subject).toContain("DEMO MODE");
  });
  it("records failure and schedules one durable retry without creating a payment", async () => {
    const i = await invoice();
    const response = await customer
      .post("/payments/demo/checkout", checkout(i.id, "FAIL_ONCE"))
      .expect(201);
    expect(response.body.outcome).toBe("FAILURE");
    expect(response.body.failureReason).toContain("temporary");
    expect(response.body.paymentId).toBeNull();
    expect(response.body.invoice.outstanding).toBe("1000.00");
    expect(response.body.recovery.retryCount).toBe(0);
    expect(response.body.recovery.status).toBe("PENDING");
    const delay =
      new Date(response.body.recovery.nextRetryAt).getTime() - Date.now();
    expect(delay).toBeGreaterThan(86_390_000);
    expect(delay).toBeLessThanOrEqual(86_400_000);
    expect(
      await db.job.count({
        where: {
          key: `payment-retry:${response.body.recoveryId}:1`,
          kind: "DEMO_PAYMENT_RETRY",
        },
      }),
    ).toBe(1);
    expect(await db.allocation.count({ where: { invoiceId: i.id } })).toBe(0);
    const notifications = await customer.get("/notifications").expect(200);
    expect(
      notifications.body.items.some(
        (item: { subject: string }) =>
          item.subject.includes(response.body.invoice.number) &&
          item.subject.includes("Payment failed"),
      ),
    ).toBe(true);
    expect(
      (
        await db.subscription.findUniqueOrThrow({
          where: { id: i.subscriptionId },
        })
      ).status,
    ).toBe("ACTIVE");
  });
  it("calculates partial amounts from the current balance and settles only when complete", async () => {
    const i = await invoice();
    await finance
      .post("/payments", {
        customerId: customer.customerId,
        reference: randomUUID(),
        amount: "400",
        currency: "INR",
        method: "BANK_TRANSFER",
        receivedAt: new Date().toISOString(),
        allocations: [{ invoiceId: i.id, amount: "400" }],
      })
      .expect(201);
    const preview = await customer
      .get(`/invoices/${i.id}/checkout`)
      .expect(200);
    expect(preview.body.amounts).toEqual({ FULL: "600.00", HALF: "300.00" });
    const half = await customer
      .post("/payments/demo/checkout", checkout(i.id, "SUCCESS", "HALF"))
      .expect(201);
    expect(half.body.amount).toBe("300.00");
    expect(half.body.invoice.outstanding).toBe("300.00");
    expect(half.body.invoice.paymentStatus).toBe("PARTIALLY_PAID");
    const full = await customer
      .post("/payments/demo/checkout", { ...checkout(i.id), method: "CARD" })
      .expect(201);
    expect(full.body.amount).toBe("300.00");
    expect(full.body.invoice.paymentStatus).toBe("PAID");
  });
  it("replays concurrent requests once and rejects a reused key with different input", async () => {
    const i = await invoice(),
      key = randomUUID(),
      input = checkout(i.id);
    const [a, b] = await Promise.all([
      paymentRequest(customer, input, key),
      paymentRequest(customer, input, key),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect(
      await db.demoPaymentAttempt.count({ where: { invoiceId: i.id } }),
    ).toBe(1);
    expect(await db.allocation.count({ where: { invoiceId: i.id } })).toBe(1);
    await paymentRequest(customer, { ...input, method: "CARD" }, key).expect(
      409,
    );
    await customer.post("/payments/demo/checkout", input).expect(409);
  });
  it("serializes full payments with different keys and prevents overcollection", async () => {
    const i = await invoice();
    const responses = await Promise.all([
      paymentRequest(customer, checkout(i.id), randomUUID()),
      paymentRequest(customer, checkout(i.id), randomUUID()),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const paid = await db.allocation.aggregate({
      where: { invoiceId: i.id },
      _sum: { amount: true },
    });
    expect(paid._sum.amount?.toString()).toBe("1000");
  });
  it("rejects supplied amounts, unauthorized customers, disallowed roles and drafts", async () => {
    const i = await invoice();
    await customer
      .post("/payments/demo/checkout", { ...checkout(i.id), amount: "1" })
      .expect(400);
    await other.post("/payments/demo/checkout", checkout(i.id)).expect(404);
    await other.get(`/invoices/${i.id}/checkout`).expect(404);
    await sales.post("/payments/demo/checkout", checkout(i.id)).expect(403);
    await customer.agent
      .post("/api/v1/payments/demo/checkout")
      .send(checkout(i.id))
      .expect(403);
    const f = await fixture(admin, customer.customerId),
      draft = await billOne(f.sub.id);
    await customer
      .post("/payments/demo/checkout", checkout(draft.invoiceId!))
      .expect(409);
    expect(
      await db.demoPaymentAttempt.count({ where: { invoiceId: i.id } }),
    ).toBe(0);
  });
  it("scopes attempt history, receipts and recovery details to the owning customer", async () => {
    const i = await invoice();
    const result = await customer
      .post("/payments/demo/checkout", checkout(i.id, "FAIL_ONCE"))
      .expect(201);
    await other.get(`/payments/demo/attempts/${result.body.id}`).expect(404);
    await other.get(`/payment-recovery/${result.body.recoveryId}`).expect(404);
    const history = await other
      .get(
        `/payments/demo/history?invoiceId=${i.id}&customerId=${customer.customerId}`,
      )
      .expect(200);
    expect(history.body.total).toBe(0);
    expect(history.body.items).toEqual([]);
    await customer.get("/payment-recovery").expect(403);
    await customer.get("/payment-recovery/summary").expect(403);
    await customer
      .post(`/payment-recovery/${result.body.recoveryId}/retry`, {
        expectedRetryCount: 0,
        outcome: "SUCCESS",
      })
      .expect(403);
  });
});

describe("smart recovery and retry management", () => {
  it("waits until due and lets the worker recover the full outstanding balance once", async () => {
    const i = await invoice(true);
    const failure = await customer
      .post("/payments/demo/checkout", checkout(i.id, "FAIL_ONCE"))
      .expect(201);
    const recoveryId = failure.body.recoveryId as string;
    await db.subscription.update({
      where: { id: i.subscriptionId },
      data: { substate: "PAST_DUE" },
    });
    expect(
      (await customer.get(`/subscriptions/${i.subscriptionId}/entitlements`))
        .body.active,
    ).toBe(false);
    expect(await processPaymentRecovery(recoveryId, 1)).toHaveProperty(
      "skipped",
      true,
    );
    await db.paymentRecovery.update({
      where: { id: recoveryId },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });
    await db.job.update({
      where: { key: `payment-retry:${recoveryId}:1` },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    for (let n = 0; n < 100; n++) {
      await processJob();
      const job = await db.job.findUniqueOrThrow({
        where: { key: `payment-retry:${recoveryId}:1` },
      });
      if (job.status === "DONE") break;
    }
    const recovered = await db.paymentRecovery.findUniqueOrThrow({
      where: { id: recoveryId },
    });
    expect(recovered.status).toBe("RECOVERED");
    expect(recovered.retryCount).toBe(1);
    expect(recovered.nextRetryAt).toBeNull();
    expect(recovered.resolvedAt).not.toBeNull();
    expect((await customer.get(`/invoices/${i.id}`)).body.paymentStatus).toBe(
      "PAID",
    );
    expect(
      (await customer.get(`/subscriptions/${i.subscriptionId}/entitlements`))
        .body.active,
    ).toBe(true);
    await processPaymentRecovery(
      recoveryId,
      1,
      new Date(Date.now() + 10 * 86_400_000),
    );
    expect(
      await db.demoPaymentAttempt.count({
        where: { invoiceId: i.id, outcome: "SUCCESS" },
      }),
    ).toBe(1);
  });
  it("allows one immediate retry per expected version and safely replays the same request", async () => {
    const i = await invoice();
    const failure = await customer
      .post("/payments/demo/checkout", checkout(i.id, "ALWAYS_FAIL"))
      .expect(201);
    const id = failure.body.recoveryId,
      key = randomUUID(),
      body = { expectedRetryCount: 0, outcome: "FAILURE" };
    const send = () =>
      finance.agent
        .post(`/api/v1/payment-recovery/${id}/retry`)
        .set("Origin", config.WEB_ORIGIN)
        .set("Idempotency-Key", key)
        .send(body);
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.id).toBe(b.body.id);
    await admin.post(`/payment-recovery/${id}/retry`, body).expect(409);
    const recovery = await db.paymentRecovery.findUniqueOrThrow({
      where: { id },
    });
    expect(recovery.retryCount).toBe(1);
    expect(recovery.nextRetryAt!.getTime() - Date.now()).toBeGreaterThan(
      3 * 86_400_000 - 10_000,
    );
    const success = await finance
      .post(`/payment-recovery/${id}/retry`, {
        expectedRetryCount: 1,
        outcome: "SUCCESS",
      })
      .expect(200);
    expect(success.body.invoice.paymentStatus).toBe("PAID");
    expect(success.body.recovery.status).toBe("RECOVERED");
  });
  it("persists repeated failures, exhausts the configured limit, and requires manual action", async () => {
    const i = await invoice(true);
    const failure = await customer
      .post("/payments/demo/checkout", checkout(i.id, "ALWAYS_FAIL"))
      .expect(201);
    const id = failure.body.recoveryId as string;
    for (let retry = 1; retry <= 3; retry++) {
      const previous = await db.paymentRecovery.findUniqueOrThrow({
        where: { id },
      });
      await processPaymentRecovery(id, retry, previous.nextRetryAt!);
      const current = await db.paymentRecovery.findUniqueOrThrow({
        where: { id },
      });
      expect(current.retryCount).toBe(retry);
      expect(current.status).toBe(retry === 3 ? "EXHAUSTED" : "PENDING");
      if (retry < 3)
        expect(
          current.nextRetryAt!.getTime() - previous.nextRetryAt!.getTime(),
        ).toBe([1, 3, 5][retry]! * 86_400_000);
    }
    const exhausted = await db.paymentRecovery.findUniqueOrThrow({
      where: { id },
    });
    expect(exhausted.nextRetryAt).toBeNull();
    expect(exhausted.resolvedAt).toBeNull();
    expect(
      await db.demoPaymentAttempt.count({
        where: { invoiceId: i.id, outcome: "FAILURE" },
      }),
    ).toBe(4);
    expect(await db.allocation.count({ where: { invoiceId: i.id } })).toBe(0);
    await finance
      .post(`/payment-recovery/${id}/retry`, {
        expectedRetryCount: 3,
        outcome: "SUCCESS",
      })
      .expect(409);
    await customer
      .post("/payments/demo/checkout", checkout(i.id, "ALWAYS_FAIL"))
      .expect(201);
    expect(
      (await db.paymentRecovery.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("EXHAUSTED");
    await customer.post("/payments/demo/checkout", checkout(i.id)).expect(201);
    expect(
      (await db.paymentRecovery.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("RECOVERED");
  });
  it("reconciles manual payments and cancels stale automatic retries", async () => {
    const i = await invoice();
    const failure = await customer
      .post("/payments/demo/checkout", checkout(i.id, "FAIL_ONCE"))
      .expect(201);
    await finance
      .post("/payments", {
        customerId: customer.customerId,
        reference: randomUUID(),
        amount: "1000",
        currency: "INR",
        method: "CASH",
        receivedAt: new Date().toISOString(),
        allocations: [{ invoiceId: i.id, amount: "1000" }],
      })
      .expect(201);
    const recovery = await db.paymentRecovery.findUniqueOrThrow({
      where: { id: failure.body.recoveryId },
    });
    expect(recovery.status).toBe("RECOVERED");
    expect(
      (
        await db.job.findUniqueOrThrow({
          where: { key: `payment-retry:${recovery.id}:1` },
        })
      ).status,
    ).toBe("DONE");
    await processPaymentRecovery(
      recovery.id,
      1,
      new Date(Date.now() + 86_400_000),
    );
    expect(
      await db.demoPaymentAttempt.count({ where: { invoiceId: i.id } }),
    ).toBe(1);
  });
  it("clears a hold only after every overdue invoice is settled, including an existing receipt allocation", async () => {
    const first = await invoice(true);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: first.subscriptionId },
    });
    const billed = await billOne(
      sub.id,
      new Date(sub.nextBillingAt.getTime() + 1),
    );
    const secondId = billed.invoiceId!;
    await db.invoice.update({
      where: { id: secondId },
      data: { dueAt: new Date(Date.now() - 86_400_000) },
    });
    await finance.post(`/invoices/${secondId}/confirm`, {}).expect(200);
    const failure = await customer
      .post("/payments/demo/checkout", checkout(secondId, "FAIL_ONCE"))
      .expect(201);
    await db.subscription.update({
      where: { id: sub.id },
      data: { substate: "PAST_DUE" },
    });
    await customer
      .post("/payments/demo/checkout", checkout(first.id))
      .expect(201);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } }))
        .substate,
    ).toBe("PAST_DUE");
    const receipt = await finance
      .post("/payments", {
        customerId: customer.customerId,
        reference: randomUUID(),
        amount: "1000",
        currency: "INR",
        method: "BANK_TRANSFER",
        receivedAt: new Date().toISOString(),
      })
      .expect(201);
    await finance
      .post(`/payments/${receipt.body.id}/allocate`, {
        invoiceId: secondId,
        amount: "1000",
      })
      .expect(200);
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: sub.id } }))
        .substate,
    ).toBeNull();
    expect(
      (
        await db.paymentRecovery.findUniqueOrThrow({
          where: { id: failure.body.recoveryId },
        })
      ).status,
    ).toBe("RECOVERED");
  });
  it("never restores paused, closed, or expired subscriptions after a payment", async () => {
    for (const status of ["PAUSED", "CLOSED"] as const) {
      const i = await invoice(true);
      await db.subscription.update({
        where: { id: i.subscriptionId },
        data: { status, substate: "PAST_DUE" },
      });
      await customer
        .post("/payments/demo/checkout", checkout(i.id))
        .expect(201);
      const sub = await db.subscription.findUniqueOrThrow({
        where: { id: i.subscriptionId },
      });
      expect(sub.status).toBe(status);
      expect(
        (await customer.get(`/subscriptions/${i.subscriptionId}/entitlements`))
          .body.active,
      ).toBe(false);
    }
  });
  it("keeps an expired contract's payment hold even when its invoice is settled", async () => {
    const expired = await invoice(true);
    await db.subscription.update({
      where: { id: expired.subscriptionId },
      data: {
        substate: "PAST_DUE",
        endAt: new Date(Date.now() - 1000),
      },
    });
    await customer
      .post("/payments/demo/checkout", checkout(expired.id))
      .expect(201);
    const stillExpired = await db.subscription.findUniqueOrThrow({
      where: { id: expired.subscriptionId },
    });
    expect(stillExpired.substate).toBe("PAST_DUE");
    expect(
      (
        await customer.get(
          `/subscriptions/${expired.subscriptionId}/entitlements`,
        )
      ).body.active,
    ).toBe(false);
  });
  it("does not reapply a payment hold from an overdue sweep captured before settlement", async () => {
    const f = await fixture(admin, customer.customerId);
    const billed = await billOne(f.sub.id);
    const id = billed.invoiceId!;
    await db.invoice.update({
      where: { id },
      data: { dueAt: new Date(Date.now() - 45 * 86_400_000) },
    });
    await finance.post(`/invoices/${id}/confirm`, {}).expect(200);
    const stale = await db.invoice.findUniqueOrThrow({
      where: { id },
      include: { allocations: true, customer: true },
    });
    await customer.post("/payments/demo/checkout", checkout(id)).expect(201);
    const sweep = vi
      .spyOn(db.invoice, "findMany")
      .mockResolvedValueOnce([stale]);
    try {
      await queueReminders();
    } finally {
      sweep.mockRestore();
    }
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: f.sub.id } }))
        .substate,
    ).toBeNull();
    expect(
      (await customer.get(`/subscriptions/${f.sub.id}/entitlements`)).body
        .active,
    ).toBe(true);
    expect(
      await db.outbox.count({
        where: { key: { startsWith: `dunning:${id}:` } },
      }),
    ).toBe(0);
  });
  it("uses real database counts in the recovery summary and list", async () => {
    const summary = await finance.get("/payment-recovery/summary").expect(200);
    expect(summary.body).toEqual({
      failedPayments: await db.demoPaymentAttempt.count({
        where: { outcome: "FAILURE" },
      }),
      pendingRetries: await db.paymentRecovery.count({
        where: { status: "PENDING" },
      }),
      recoveredPayments: await db.paymentRecovery.count({
        where: { status: "RECOVERED" },
      }),
      exhaustedCases: await db.paymentRecovery.count({
        where: { status: "EXHAUSTED" },
      }),
    });
    const listing = await finance
      .get("/payment-recovery?status=PENDING")
      .expect(200);
    expect(listing.body.total).toBe(summary.body.pendingRetries);
    expect(
      listing.body.items.every(
        (row: { status: string; invoice: { outstanding: string } }) =>
          row.status === "PENDING" && Number(row.invoice.outstanding) > 0,
      ),
    ).toBe(true);
  });
  it("validates admin policy changes and snapshots new-case schedules", async () => {
    await finance
      .post("/payment-recovery/policy", { retryDays: [1] })
      .expect(404);
    await finance.agent
      .put("/api/v1/payment-recovery/policy")
      .set("Origin", config.WEB_ORIGIN)
      .send({ retryDays: [1] })
      .expect(403);
    const update = (retryDays: number[]) =>
      admin.agent
        .put("/api/v1/payment-recovery/policy")
        .set("Origin", config.WEB_ORIGIN)
        .set("Idempotency-Key", randomUUID())
        .send({ retryDays });
    await update([0, 3]).expect(400);
    await update([2]).expect(200);
    const i = await invoice(),
      failure = await customer
        .post("/payments/demo/checkout", checkout(i.id, "ALWAYS_FAIL"))
        .expect(201);
    expect(failure.body.recovery.retryDays).toEqual([2]);
    await update([1, 3, 5]).expect(200);
    await finance
      .post(`/payment-recovery/${failure.body.recoveryId}/retry`, {
        expectedRetryCount: 0,
        outcome: "FAILURE",
      })
      .expect(200);
    expect(
      (
        await db.paymentRecovery.findUniqueOrThrow({
          where: { id: failure.body.recoveryId },
        })
      ).status,
    ).toBe("EXHAUSTED");
  });
});
