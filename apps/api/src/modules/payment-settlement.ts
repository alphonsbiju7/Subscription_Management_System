import { audit, outbox, type Tx } from "../db.js";
import { D, sum } from "../../../../packages/billing-engine/src/index.js";

// Called inside the same transaction as every receipt/allocation, including manual finance receipts.
// Invoice payment status stays derived from allocations; issued invoice rows remain immutable.
export async function reconcilePaymentSettlement(
  tx: Tx,
  invoiceIds: string[],
  actorId: string,
) {
  const subscriptions = new Set<string>();
  for (const id of [...new Set(invoiceIds)].sort()) {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id },
      include: { allocations: true, paymentRecovery: true, customer: true },
    });
    subscriptions.add(invoice.subscriptionId);
    const remaining = D(invoice.total.toString()).minus(
      sum(invoice.allocations.map((a) => a.amount.toString())),
    );
    if (
      remaining.lte(0) &&
      invoice.paymentRecovery &&
      invoice.paymentRecovery.status !== "RECOVERED"
    ) {
      const recovery = invoice.paymentRecovery;
      await tx.paymentRecovery.update({
        where: { id: recovery.id },
        data: {
          status: "RECOVERED",
          nextRetryAt: null,
          resolvedAt: new Date(),
        },
      });
      await tx.job.updateMany({
        where: {
          key: { startsWith: `payment-retry:${recovery.id}:` },
          status: "PENDING",
        },
        data: { status: "DONE", finishedAt: new Date(), lockedAt: null },
      });
      await audit(tx, actorId, "PAYMENT_RECOVERY_RESOLVED", recovery.id, {
        invoiceId: id,
      });
      await outbox(
        tx,
        `recovery-resolved:${recovery.id}`,
        invoice.customer.email,
        `DEMO MODE: Payment recovery resolved for ${invoice.number}`,
        {
          text: `The outstanding balance of ${invoice.number} is settled. Automatic demo retries have stopped. View your invoice in the portal.`,
        },
      );
    }
  }
  for (const subscriptionId of subscriptions) {
    const subscription = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    if (
      subscription.status !== "ACTIVE" ||
      subscription.substate !== "PAST_DUE" ||
      (subscription.endAt !== null && subscription.endAt <= new Date())
    )
      continue;
    const overdue = await tx.invoice.findMany({
      where: {
        subscriptionId,
        status: "CONFIRMED",
        dueAt: { lt: new Date() },
      },
      include: { allocations: true },
    });
    if (
      overdue.some((i) =>
        D(i.total.toString()).gt(
          sum(i.allocations.map((a) => a.amount.toString())),
        ),
      )
    )
      continue;
    await tx.subscription.update({
      where: { id: subscriptionId },
      data: { substate: null },
    });
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId,
        action: "PAYMENT_HOLD_CLEARED",
        actorId,
        data: { reason: "All overdue issued invoices settled" },
      },
    });
  }
}
