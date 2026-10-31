import { Router } from "express";
import {
  Prisma,
  type DemoPaymentMethod,
  type DemoPaymentOutcome,
  type PaymentRecovery,
} from "@prisma/client";
import { allow, customerScope, own } from "../access.js";
import { check } from "../errors.js";
import {
  audit,
  db,
  json,
  lock,
  number,
  outbox,
  transaction,
  type Tx,
} from "../db.js";
import { idempotent, recordPaymentTx } from "./finance.js";
import { reconcilePaymentSettlement } from "./payment-settlement.js";
import {
  D,
  money,
  paymentState,
  sum,
} from "../../../../packages/billing-engine/src/index.js";
import {
  demoCheckoutInput,
  pageInput,
  recoveryPolicyInput,
  recoveryRetryInput,
} from "../../../../packages/validation/src/index.js";
import type { Actor } from "../../../../packages/shared-types/src/index.js";
import type { z } from "zod";

export const demoPayments = Router();
const readers = allow("ADMIN", "FINANCE", "CUSTOMER");
const operators = allow("ADMIN", "FINANCE");
const invoiceInclude = {
  customer: { select: { id: true, name: true, email: true } },
  allocations: true,
} satisfies Prisma.InvoiceInclude;
type Invoice = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
const attemptInclude = {
  invoice: { include: invoiceInclude },
  recovery: true,
  payment: true,
} satisfies Prisma.DemoPaymentAttemptInclude;
type Attempt = Prisma.DemoPaymentAttemptGetPayload<{
  include: typeof attemptInclude;
}>;
const recoveryInclude = {
  invoice: { include: invoiceInclude },
} satisfies Prisma.PaymentRecoveryInclude;

function invoiceSummary(invoice: Invoice) {
  return {
    id: invoice.id,
    number: invoice.number,
    customer: { id: invoice.customer.id, name: invoice.customer.name },
    subscriptionId: invoice.subscriptionId,
    currency: invoice.currency,
    total: money(invoice.total.toString()),
    dueAt: invoice.dueAt,
    ...paymentState(
      invoice.total.toString(),
      sum(invoice.allocations.map((a) => a.amount.toString())).toString(),
      invoice.dueAt,
    ),
  };
}
function attemptView(attempt: Attempt) {
  return {
    ...attempt,
    mode: "DEMO MODE",
    amount: money(attempt.amount.toString()),
    invoice: invoiceSummary(attempt.invoice),
  };
}
function recoveryView(
  recovery: Prisma.PaymentRecoveryGetPayload<{
    include: typeof recoveryInclude;
  }>,
) {
  return {
    ...recovery,
    mode: "DEMO MODE",
    invoice: invoiceSummary(recovery.invoice),
  };
}
async function lockedInvoice(tx: Tx, invoiceId: string, actor: Actor) {
  const owner = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { customerId: true },
  });
  check(owner, "Invoice not found", 404);
  own(actor, owner.customerId);
  // The same lock ordering is used by manual payment recording and allocation.
  await lock(tx, `customer-finance:${owner.customerId}`);
  await lock(tx, `invoice:${invoiceId}`);
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: invoiceInclude,
  });
  check(
    invoice.status === "CONFIRMED",
    "Demo checkout is available only for issued invoices",
    409,
  );
  return invoice;
}
async function scheduleRetry(tx: Tx, recovery: PaymentRecovery) {
  if (recovery.status !== "PENDING" || !recovery.nextRetryAt) return;
  const key = `payment-retry:${recovery.id}:${recovery.retryCount + 1}`;
  await tx.job.upsert({
    where: { key },
    create: {
      key,
      kind: "DEMO_PAYMENT_RETRY",
      availableAt: recovery.nextRetryAt,
      payload: {
        recoveryId: recovery.id,
        retryNumber: recovery.retryCount + 1,
      },
    },
    update: {},
  });
}
const nextRetry = (now: Date, days: number) =>
  new Date(now.getTime() + days * 86_400_000);
async function notifyFailure(
  tx: Tx,
  invoice: Invoice,
  recovery: PaymentRecovery,
  attemptId: string,
) {
  const timing = recovery.nextRetryAt
    ? `Next demo retry: ${recovery.nextRetryAt.toISOString()}.`
    : "Automatic retries are exhausted. Please retry manually or contact finance.";
  await outbox(
    tx,
    `demo-failed:${attemptId}`,
    invoice.customer.email,
    `DEMO MODE: Payment failed for ${invoice.number}${recovery.status === "EXHAUSTED" ? " — manual action required" : " — retry scheduled"}`,
    {
      text: `${recovery.lastFailure} ${timing} No money was moved. Your invoice balance is unchanged. Open /invoices/${invoice.id} in your portal.`,
    },
  );
}
async function createAttempt(
  tx: Tx,
  invoice: Invoice,
  actor: Actor,
  method: DemoPaymentMethod,
  outcome: DemoPaymentOutcome,
  amount: string,
  recovery: PaymentRecovery | null,
  retryNumber: number,
  failureReason: string | null,
) {
  const reference = number("DEMO");
  const payment =
    outcome === "SUCCESS"
      ? await recordPaymentTx(
          tx,
          {
            customerId: invoice.customerId,
            reference,
            amount,
            currency: invoice.currency,
            method: `DEMO_${method}`,
            receivedAt: new Date(),
            notes: `DEMO MODE: Simulated ${method.replaceAll("_", " ")} payment. No real money moved.`,
            allocations: [{ invoiceId: invoice.id, amount }],
          },
          actor,
        )
      : null;
  const attempt = await tx.demoPaymentAttempt.create({
    data: {
      invoiceId: invoice.id,
      recoveryId: recovery?.id,
      paymentId: payment?.id,
      transactionReference: reference,
      method,
      outcome,
      amount,
      failureReason,
      retryNumber,
      actorId: actor.id,
    },
    include: attemptInclude,
  });
  await audit(
    tx,
    actor.id,
    `DEMO_PAYMENT_${outcome}`,
    attempt.id,
    {
      mode: "DEMO MODE",
      invoiceId: invoice.id,
      amount,
      reference,
      retryNumber,
      recoveryId: recovery?.id,
      failureReason,
    },
    actor.requestId,
  );
  if (outcome === "FAILURE" && recovery)
    await notifyFailure(tx, invoice, recovery, attempt.id);
  return attemptView(attempt);
}

export async function demoCheckout(
  input: z.infer<typeof demoCheckoutInput>,
  actor: Actor,
  key: string,
) {
  return transaction(async (tx) => {
    // Check ownership on every request, including idempotent replays.
    const visible = await tx.invoice.findFirst({
      where: { id: input.invoiceId, ...customerScope(actor) },
    });
    check(visible, "Invoice not found", 404);
    return idempotent(tx, key, actor, "demo-checkout", input, async () => {
      const invoice = await lockedInvoice(tx, input.invoiceId, actor);
      const outstanding = D(invoiceSummary(invoice).outstanding);
      check(outstanding.gt(0), "This invoice is already settled", 409);
      const amount = money(
        input.portion === "HALF" ? outstanding.div(2) : outstanding,
      );
      check(
        D(amount).gt(0) && D(amount).lte(outstanding),
        "Invalid payment portion",
      );
      let recovery = await tx.paymentRecovery.findUnique({
        where: { invoiceId: invoice.id },
      });
      const outcome = input.scenario === "SUCCESS" ? "SUCCESS" : "FAILURE";
      const failureReason =
        outcome === "FAILURE"
          ? input.scenario === "FAIL_ONCE"
            ? "DEMO MODE: Simulated temporary payment decline. Automatic retries are set to succeed."
            : "DEMO MODE: Simulated persistent payment decline. Automatic retries are set to fail."
          : null;
      if (outcome === "FAILURE") {
        const retryOutcome =
          input.scenario === "FAIL_ONCE" ? "SUCCESS" : "FAILURE";
        if (!recovery) {
          const setting = await tx.setting.findUnique({
            where: { key: "payment-recovery" },
          });
          const policy = recoveryPolicyInput.parse(
            setting?.value ?? { retryDays: [1, 3, 5] },
          );
          recovery = await tx.paymentRecovery.create({
            data: {
              invoiceId: invoice.id,
              method: input.method,
              retryOutcome,
              retryDays: policy.retryDays,
              nextRetryAt: nextRetry(new Date(), policy.retryDays[0]!),
              lastFailure: failureReason!,
            },
          });
        } else {
          // A fresh checkout never resets the recovery budget or reopens an exhausted case.
          recovery = await tx.paymentRecovery.update({
            where: { id: recovery.id },
            data: {
              method: input.method,
              retryOutcome,
              lastFailure: failureReason!,
            },
          });
        }
        await scheduleRetry(tx, recovery);
      }
      return createAttempt(
        tx,
        invoice,
        actor,
        input.method,
        outcome,
        amount,
        recovery,
        0,
        failureReason,
      );
    });
  });
}

async function executeRetry(
  tx: Tx,
  recoveryId: string,
  expectedCount: number,
  actor: Actor,
  override: DemoPaymentOutcome | undefined,
  now: Date,
  force: boolean,
) {
  const initial = await tx.paymentRecovery.findUnique({
    where: { id: recoveryId },
  });
  check(initial, "Recovery case not found", 404);
  const invoice = await lockedInvoice(tx, initial.invoiceId, actor);
  const recovery = await tx.paymentRecovery.findUniqueOrThrow({
    where: { id: recoveryId },
  });
  if (recovery.status !== "PENDING" || recovery.retryCount !== expectedCount) {
    check(!force, "This recovery case changed. Refresh before retrying", 409);
    return {
      skipped: true,
      reason: "Recovery is complete or this retry was already processed",
    };
  }
  if (!force && (!recovery.nextRetryAt || recovery.nextRetryAt > now))
    return { skipped: true, reason: "Retry is not due" };
  const amount = invoiceSummary(invoice).outstanding;
  if (D(amount).lte(0)) {
    await reconcilePaymentSettlement(tx, [invoice.id], actor.id);
    return { skipped: true, reason: "Invoice already settled" };
  }
  check(
    recovery.retryCount < recovery.retryDays.length,
    "Retry limit reached",
    409,
  );
  const retryNumber = recovery.retryCount + 1;
  const outcome = override ?? recovery.retryOutcome;
  const exhausted =
    outcome === "FAILURE" && retryNumber >= recovery.retryDays.length;
  const failureReason =
    outcome === "FAILURE"
      ? "DEMO MODE: Simulated payment decline during recovery."
      : null;
  // Increment before using the shared receipt service, which resolves fully settled cases atomically.
  const updated = await tx.paymentRecovery.update({
    where: { id: recovery.id },
    data: {
      retryCount: retryNumber,
      status:
        outcome === "SUCCESS"
          ? "RECOVERED"
          : exhausted
            ? "EXHAUSTED"
            : "PENDING",
      resolvedAt: outcome === "SUCCESS" ? now : null,
      nextRetryAt:
        outcome === "SUCCESS" || exhausted
          ? null
          : nextRetry(now, recovery.retryDays[retryNumber]!),
      ...(failureReason ? { lastFailure: failureReason } : {}),
    },
  });
  const result = await createAttempt(
    tx,
    invoice,
    actor,
    recovery.method,
    outcome,
    amount,
    updated,
    retryNumber,
    failureReason,
  );
  if (outcome === "SUCCESS") {
    await audit(tx, actor.id, "PAYMENT_RECOVERY_RESOLVED", recovery.id, {
      invoiceId: invoice.id,
    });
    await outbox(
      tx,
      `recovery-resolved:${recovery.id}`,
      invoice.customer.email,
      `DEMO MODE: Payment recovery resolved for ${invoice.number}`,
      {
        text: "Your simulated payment succeeded. No real money moved. Your invoice is settled and automatic retries have stopped.",
      },
    );
  }
  if (exhausted && invoice.dueAt < now)
    await tx.subscription.updateMany({
      where: {
        id: invoice.subscriptionId,
        status: "ACTIVE",
        substate: null,
      },
      data: { substate: "PAST_DUE" },
    });
  // Retire an old scheduled job when an operator ran this same retry immediately.
  await tx.job.updateMany({
    where: {
      key: `payment-retry:${recovery.id}:${retryNumber}`,
      status: "PENDING",
    },
    data: { status: "DONE", finishedAt: now, lockedAt: null },
  });
  await scheduleRetry(tx, updated);
  return result;
}
export async function processPaymentRecovery(
  recoveryId: string,
  retryNumber: number,
  now = new Date(),
) {
  return transaction((tx) =>
    executeRetry(
      tx,
      recoveryId,
      retryNumber - 1,
      { id: "demo-recovery-worker", role: "ADMIN", customerId: null },
      undefined,
      now,
      false,
    ),
  );
}

demoPayments.get("/invoices/:id/checkout", readers, async (req, res) => {
  const invoice = await db.invoice.findFirst({
    where: { id: String(req.params.id), ...customerScope(req.actor) },
    include: invoiceInclude,
  });
  check(invoice, "Invoice not found", 404);
  check(
    invoice.status === "CONFIRMED",
    "Only issued invoices can be paid",
    409,
  );
  const recovery = await db.paymentRecovery.findUnique({
    where: { invoiceId: invoice.id },
  });
  const summary = invoiceSummary(invoice);
  res.json({
    mode: "DEMO MODE",
    invoice: summary,
    recovery,
    amounts: {
      FULL: summary.outstanding,
      HALF: money(D(summary.outstanding).div(2)),
    },
  });
});
demoPayments.post("/payments/demo/checkout", readers, async (req, res) => {
  res
    .status(201)
    .json(
      await demoCheckout(
        demoCheckoutInput.parse(req.body),
        req.actor,
        req.get("Idempotency-Key") ?? "",
      ),
    );
});
demoPayments.get("/payments/demo/history", readers, async (req, res) => {
  const q = pageInput.parse(req.query);
  const invoiceId =
    typeof req.query.invoiceId === "string" ? req.query.invoiceId : undefined;
  const where: Prisma.DemoPaymentAttemptWhereInput = {
    invoice: {
      ...customerScope(req.actor),
      ...(q.customerId
        ? { customerId: q.customerId, ...customerScope(req.actor) }
        : {}),
    },
    ...(invoiceId ? { invoiceId } : {}),
    ...(q.status === "SUCCESS" || q.status === "FAILURE"
      ? { outcome: q.status }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.demoPaymentAttempt.findMany({
      where,
      include: attemptInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    db.demoPaymentAttempt.count({ where }),
  ]);
  res.json({ items: items.map(attemptView), total });
});
demoPayments.get("/payments/demo/attempts/:id", readers, async (req, res) => {
  const attempt = await db.demoPaymentAttempt.findFirst({
    where: { id: String(req.params.id), invoice: customerScope(req.actor) },
    include: attemptInclude,
  });
  check(attempt, "Payment attempt not found", 404);
  res.json(attemptView(attempt));
});
demoPayments.get("/payment-recovery/summary", operators, async (_req, res) => {
  res.json(
    await transaction(async (tx) => ({
      failedPayments: await tx.demoPaymentAttempt.count({
        where: { outcome: "FAILURE" },
      }),
      pendingRetries: await tx.paymentRecovery.count({
        where: { status: "PENDING" },
      }),
      recoveredPayments: await tx.paymentRecovery.count({
        where: { status: "RECOVERED" },
      }),
      exhaustedCases: await tx.paymentRecovery.count({
        where: { status: "EXHAUSTED" },
      }),
    })),
  );
});
demoPayments.get("/payment-recovery/policy", operators, async (_req, res) => {
  const setting = await db.setting.findUnique({
    where: { key: "payment-recovery" },
  });
  res.json(
    recoveryPolicyInput.parse(setting?.value ?? { retryDays: [1, 3, 5] }),
  );
});
demoPayments.put(
  "/payment-recovery/policy",
  allow("ADMIN"),
  async (req, res) => {
    const input = recoveryPolicyInput.parse(req.body);
    res.json(
      await transaction((tx) =>
        idempotent(
          tx,
          req.get("Idempotency-Key") ?? "",
          req.actor,
          "recovery-policy",
          input,
          async () => {
            await tx.setting.upsert({
              where: { key: "payment-recovery" },
              create: { key: "payment-recovery", value: json(input) },
              update: { value: json(input) },
            });
            await audit(
              tx,
              req.actor.id,
              "PAYMENT_RECOVERY_POLICY_UPDATED",
              "payment-recovery",
              input,
            );
            return input;
          },
        ),
      ),
    );
  },
);
demoPayments.get("/payment-recovery", operators, async (req, res) => {
  const q = pageInput.parse(req.query);
  const where: Prisma.PaymentRecoveryWhereInput = {
    ...(q.status && ["PENDING", "RECOVERED", "EXHAUSTED"].includes(q.status)
      ? { status: q.status as PaymentRecovery["status"] }
      : {}),
    invoice: {
      ...(q.customerId ? { customerId: q.customerId } : {}),
      OR: [
        { number: { contains: q.search, mode: "insensitive" } },
        { customer: { name: { contains: q.search, mode: "insensitive" } } },
      ],
    },
  };
  const [items, total] = await Promise.all([
    db.paymentRecovery.findMany({
      where,
      include: recoveryInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    db.paymentRecovery.count({ where }),
  ]);
  res.json({ items: items.map(recoveryView), total });
});
demoPayments.get("/payment-recovery/:id", readers, async (req, res) => {
  const recovery = await db.paymentRecovery.findFirst({
    where: { id: String(req.params.id), invoice: customerScope(req.actor) },
    include: recoveryInclude,
  });
  check(recovery, "Recovery case not found", 404);
  res.json(recoveryView(recovery));
});
demoPayments.post(
  "/payment-recovery/:id/retry",
  operators,
  async (req, res) => {
    const input = recoveryRetryInput.parse(req.body),
      id = String(req.params.id);
    res.json(
      await transaction((tx) =>
        idempotent(
          tx,
          req.get("Idempotency-Key") ?? "",
          req.actor,
          `recovery-retry:${id}`,
          input,
          () =>
            executeRetry(
              tx,
              id,
              input.expectedRetryCount,
              req.actor,
              input.outcome,
              new Date(),
              true,
            ),
        ),
      ),
    );
  },
);
