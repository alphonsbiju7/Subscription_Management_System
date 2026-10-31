import { PrismaClient, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { config } from "./config.js";
import pino from "pino";
export const logger = pino({
  level: config.NODE_ENV === "test" ? "silent" : "info",
  redact: [
    "password",
    "token",
    "secret",
    "req.headers.authorization",
    "req.headers.cookie",
  ],
});
export const db = new PrismaClient({ log: ["error"] });
export type Tx = Prisma.TransactionClient;
export const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const digest = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(canonical(JSON.parse(JSON.stringify(value)) as unknown)),
    )
    .digest("hex");
export const number = (prefix: string) =>
  `${prefix}-${new Date().getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 20000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code) &&
        attempt < 4
      )
        continue;
      throw error;
    }
  }
}
export async function lock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
export async function audit(
  tx: Tx,
  actorId: string,
  action: string,
  target: string,
  data: unknown = {},
  requestId?: string,
) {
  return tx.auditLog.create({
    data: { actorId, action, target, data: json(data), requestId },
  });
}
export async function outbox(
  tx: Tx,
  key: string,
  recipient: string,
  subject: string,
  payload: unknown,
) {
  return tx.outbox.upsert({
    where: { key },
    create: { key, recipient, subject, kind: "EMAIL", payload: json(payload) },
    update: {},
  });
}
