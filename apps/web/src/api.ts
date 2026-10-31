import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
export async function api<T = unknown>(
  path: string,
  body?: unknown,
  method = "POST",
  idempotencyKey?: string,
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: body === undefined ? "GET" : method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(body !== undefined
        ? { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await res.json();
  if (!res.ok) {
    const error = data as {
      error?: string;
      details?: { message: string; path: string }[];
    };
    throw new Error(
      [
        error.error ?? "Request failed",
        ...(error.details?.map((d) => `${d.path}: ${d.message}`) ?? []),
      ].join(" · "),
    );
  }
  return data as T;
}
export type RecordData = { id: string; [key: string]: unknown };
export type PageData = {
  items: RecordData[];
  total?: number;
  [key: string]: unknown;
};
export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  requiresMfa: boolean;
  twoFactorEnabled: boolean;
  customerId: string | null;
  customer: RecordData | null;
};
export const value = (row: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (r, k) =>
        r && typeof r === "object"
          ? (r as Record<string, unknown>)[k]
          : undefined,
      row,
    );
export const text = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
export const fmtDate = (v: unknown) =>
  v
    ? new Date(String(v)).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
export const fmtMoney = (v: unknown, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(v ?? 0));
