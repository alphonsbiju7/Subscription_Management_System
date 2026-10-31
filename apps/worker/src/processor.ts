import { mkdir, writeFile } from "node:fs/promises";
import nodemailer from "nodemailer";
import {
  db,
  transaction,
  json,
  outbox,
  logger,
  lock,
} from "../../api/src/db.js";
import { config } from "../../api/src/config.js";
import { decrypt } from "../../api/src/crypto.js";
import { catchUp } from "../../api/src/modules/billing.js";
import { processPaymentRecovery } from "../../api/src/modules/demo-payments.js";
import type { Job, Outbox } from "@prisma/client";
export async function enqueueDue() {
  const due = await db.subscription.findMany({
    where: { status: "ACTIVE", nextBillingAt: { lte: new Date() } },
    take: 100,
    orderBy: { nextBillingAt: "asc" },
  });
  for (const sub of due) {
    const key = `bill:${sub.id}:${sub.nextBillingAt.toISOString()}`;
    await db.job.upsert({
      where: { key },
      create: { key, kind: "BILL", payload: { subscriptionId: sub.id } },
      update: {},
    });
  }
  return due.length;
}
export async function processJob() {
  const jobs = await db.$queryRaw<
    Job[]
  >`UPDATE "Job" SET status='RUNNING', "lockedAt"=NOW(), attempts=attempts+1 WHERE id=(SELECT id FROM "Job" WHERE (status='PENDING' AND "availableAt"<=NOW()) OR (status='RUNNING' AND "lockedAt"<NOW()-INTERVAL '5 minutes') ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  const job = jobs[0];
  if (!job) return false;
  const run = await db.jobRun.create({ data: { jobId: job.id } });
  try {
    let results: unknown;
    if (job.kind === "BILL") {
      const payload = job.payload as { subscriptionId: string };
      results = await catchUp(payload.subscriptionId);
    } else if (job.kind === "DEMO_PAYMENT_RETRY") {
      const payload = job.payload as {
        recoveryId: string;
        retryNumber: number;
      };
      results = await processPaymentRecovery(
        payload.recoveryId,
        payload.retryNumber,
      );
    } else throw new Error("Unsupported durable job kind");
    await transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          finishedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
      await tx.jobRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), result: json(results) },
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 500) : "Job failed";
    await transaction(async (tx) => {
      await tx.job.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= 5 ? "DEAD" : "PENDING",
          availableAt: new Date(
            Date.now() + Math.min(3600000, 1000 * 2 ** job.attempts),
          ),
          lockedAt: null,
          lastError: message,
        },
      });
      await tx.jobRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), error: message },
      });
    });
    logger.warn({ jobId: job.id }, "Background job will retry or needs review");
  }
  return true;
}
const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE === "true",
  auth: config.SMTP_USER
    ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
    : undefined,
  connectionTimeout: 10000,
  socketTimeout: 10000,
  disableFileAccess: true,
  disableUrlAccess: true,
});
export async function deliverNotification(
  send?: (message: {
    to: string;
    subject: string;
    text: string;
  }) => Promise<void>,
) {
  const claimed = await db.$queryRaw<
    Outbox[]
  >`UPDATE "Outbox" SET status='SENDING', "lockedAt"=NOW(), attempts=attempts+1 WHERE id=(SELECT id FROM "Outbox" WHERE (status='PENDING' AND "availableAt"<=NOW()) OR (status='SENDING' AND "lockedAt"<NOW()-INTERVAL '5 minutes') ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  const item = claimed[0];
  if (!item) return false;
  try {
    const payload = item.payload as { text?: string; encrypted?: string };
    const text = payload.encrypted
      ? decrypt(payload.encrypted)
      : (payload.text ?? "");
    if (send) await send({ to: item.recipient, subject: item.subject, text });
    else if (config.NODE_ENV !== "production") {
      await mkdir(".local/mail", { recursive: true });
      await writeFile(
        `.local/mail/${item.id}.txt`,
        `To: ${item.recipient}\nSubject: ${item.subject}\n\n${text}`,
        { mode: 0o600 },
      );
    } else
      await transport.sendMail({
        from: config.SMTP_FROM,
        to: { address: item.recipient, name: "" },
        subject: item.subject,
        text,
        messageId: `<${item.id}@brightloop.local>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    await db.outbox.update({
      where: { id: item.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
  } catch {
    await db.outbox.update({
      where: { id: item.id },
      data: {
        status: item.attempts >= 5 ? "DEAD" : "PENDING",
        lockedAt: null,
        availableAt: new Date(
          Date.now() + Math.min(3600000, 1000 * 2 ** item.attempts),
        ),
        lastError: "Delivery failed. Check mail transport configuration.",
      },
    });
  }
  return true;
}
export async function queueReminders() {
  const setting = await db.setting.findUnique({ where: { key: "business" } });
  const policy = (setting?.value ?? {
    graceDays: 14,
    reminderDays: [1, 3, 7, 14],
    renewalNoticeDays: 7,
  }) as {
    graceDays: number;
    reminderDays: number[];
    renewalNoticeDays: number;
  };
  const invoices = await db.invoice.findMany({
    where: { status: "CONFIRMED", dueAt: { lt: new Date() } },
    include: { allocations: true, customer: true },
    take: 500,
    orderBy: { dueAt: "asc" },
  });
  const { D, sum } = await import(
    "../../../packages/billing-engine/src/index.js"
  );
  for (const candidate of invoices) {
    await transaction(async (tx) => {
      // The sweep can be stale by the time this invoice is handled. Serialize
      // the balance check and hold with checkout, recovery, and manual receipts.
      await lock(tx, `customer-finance:${candidate.customerId}`);
      await lock(tx, `invoice:${candidate.id}`);
      const i = await tx.invoice.findUnique({
        where: { id: candidate.id },
        include: { allocations: true, customer: true },
      });
      const now = new Date();
      if (!i || i.status !== "CONFIRMED" || i.dueAt >= now) return;
      const outstanding = D(i.total.toString()).minus(
        sum(i.allocations.map((a) => a.amount.toString())),
      );
      if (outstanding.lte(0)) return;
      const days = Math.floor((now.getTime() - i.dueAt.getTime()) / 86400000),
        step = [...policy.reminderDays]
          .sort((a, b) => b - a)
          .find((d) => days >= d);
      if (!step) return;
      await outbox(
        tx,
        `dunning:${i.id}:${step}`,
        i.customer.email,
        `Payment reminder: ${i.number}`,
        {
          text: `${i.number} has ${i.currency} ${outstanding.toFixed(2)} outstanding. Please contact Brightloop finance.`,
        },
      );
      if (days >= policy.graceDays)
        await tx.subscription.updateMany({
          where: { id: i.subscriptionId, status: "ACTIVE", substate: null },
          data: { substate: "PAST_DUE" },
        });
    });
  }
  const soon = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      endAt: {
        gt: new Date(),
        lte: new Date(Date.now() + policy.renewalNoticeDays * 86400000),
      },
    },
    include: { customer: true },
    take: 500,
  });
  for (const s of soon)
    await outbox(
      db,
      `renewal:${s.id}:${s.endAt!.toISOString()}`,
      s.customer.email,
      `Renewal approaching: ${s.number}`,
      {
        text: `${s.number} ends ${s.endAt!.toISOString()}. Review renewal options in your portal.`,
      },
    );
  await db.quote.updateMany({
    where: { status: "SENT", validUntil: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}
