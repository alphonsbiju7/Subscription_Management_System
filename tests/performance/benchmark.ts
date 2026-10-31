import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
if (process.env.NODE_ENV === "production")
  throw new Error("Benchmark seeding is development-only");
const original = new URL(process.env.DATABASE_URL!),
  adminUrl = new URL(original);
adminUrl.pathname = "/postgres";
const maintenance = new PrismaClient({ datasourceUrl: adminUrl.href });
const exists = await maintenance.$queryRaw<
  { exists: boolean }[]
>`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='brightloop_benchmark')`;
if (!exists[0]?.exists)
  await maintenance.$executeRawUnsafe(
    `CREATE DATABASE "brightloop_benchmark" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`,
  );
await maintenance.$disconnect();
original.pathname = "/brightloop_benchmark";
process.env.DATABASE_URL = original.href;
process.env.NODE_ENV = "test";
const migration = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { env: process.env, stdio: "inherit" },
);
if (migration.status !== 0) throw new Error("Benchmark migration failed");
const { db, json, digest } = await import("../../apps/api/src/db.js");
const { calculateBill } = await import(
  "../../packages/billing-engine/src/index.js"
);
if (!(await db.setting.findUnique({ where: { key: "benchmark-seeded" } }))) {
  const tax = await db.tax.create({
    data: {
      id: "bench-tax",
      name: "Benchmark GST",
      components: [{ name: "IGST", rate: "18" }],
      startsAt: new Date("2020-01-01"),
    },
  });
  await db.discount.create({
    data: {
      id: "bench-discount",
      code: "BENCH10",
      type: "PERCENT",
      value: "10",
      startsAt: new Date("2020-01-01"),
      endsAt: new Date("2030-01-01"),
      usageLimit: 10000,
    },
  });
  const product = await db.product.create({
    data: { id: "bench-product", name: "Benchmark CRM", salesPrice: "1000" },
  });
  const plan = await db.plan.create({
    data: {
      id: "bench-plan",
      name: "Benchmark monthly",
      productId: product.id,
      versions: {
        create: {
          id: "bench-version",
          price: "1000",
          interval: "MONTHLY",
          taxId: tax.id,
        },
      },
    },
    include: { versions: true },
  });
  const contract = {
    model: "PER_SEAT",
    tiers: [],
    packageSize: 1,
    setupFee: "0",
    addonCharge: "0",
    includedUsage: "0",
    usageRate: "0",
    entitlements: { seats: 1 },
    tax: {
      name: "GST",
      inclusive: false,
      components: [{ name: "IGST", rate: "18" }],
    },
    productId: product.id,
    version: 1,
    canPause: true,
    canCancel: true,
    trialDays: 0,
  };
  for (let begin = 0; begin < 1000; begin += 250)
    await db.customer.createMany({
      data: Array.from({ length: 250 }, (_, i) => ({
        id: `bench-customer-${begin + i}`,
        number: `BENCH-CUS-${begin + i}`,
        name: `Benchmark customer ${begin + i}`,
        email: `bench-${begin + i}@example.test`,
        company: `Segment ${(begin + i) % 10}`,
      })),
    });
  const year = new Date().getUTCFullYear();
  for (let begin = 0; begin < 5000; begin += 250) {
    const subs = Array.from({ length: 250 }, (_, i) => {
      const index = begin + i;
      return {
        id: `bench-sub-${index}`,
        number: `BENCH-SUB-${index}`,
        customerId: `bench-customer-${index % 1000}`,
        status: "ACTIVE" as const,
        interval: "MONTHLY" as const,
        startAt: new Date(`${year}-07-01T00:00:00Z`),
        nextBillingAt: new Date(`${year}-11-01T00:00:00Z`),
        anchorDay: 1,
      };
    });
    await db.subscription.createMany({ data: subs });
    await db.subscriptionItem.createMany({
      data: subs.map((s) => ({
        id: `${s.id}-item`,
        subscriptionId: s.id,
        planVersionId: plan.versions[0]!.id,
        description: "Benchmark CRM",
        quantity: 1,
        unitPrice: "1000",
        snapshot: json(contract),
      })),
    });
    for (let month = 7; month <= 10; month++) {
      const startAt = new Date(
          `${year}-${String(month).padStart(2, "0")}-01T00:00:00Z`,
        ),
        endAt = new Date(
          `${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00Z`,
        );
      await db.billingPeriod.createMany({
        data: subs.map((s) => ({
          id: `${s.id}-period-${month}`,
          subscriptionId: s.id,
          startAt,
          endAt,
        })),
      });
      const input = {
        at: startAt.toISOString(),
        lines: [
          {
            description: "Benchmark CRM",
            model: "PER_SEAT",
            quantity: "1",
            unitPrice: "1000",
            tax: contract.tax,
          },
        ],
      };
      const expected = calculateBill(input);
      const snapshot = {
        input,
        expected,
        customer: {
          name: "Benchmark customer",
          email: "benchmark@example.test",
          company: "Benchmark",
          billingAddress: "India",
          taxId: "",
        },
        period: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
      };
      await db.invoice.createMany({
        data: subs.map((s) => ({
          id: `${s.id}-invoice-${month}`,
          number: `BENCH-INV-${s.id}-${month}`,
          customerId: s.customerId,
          subscriptionId: s.id,
          periodId: `${s.id}-period-${month}`,
          status: "CONFIRMED",
          currency: "INR",
          issuedAt: startAt,
          dueAt: new Date(startAt.getTime() + 14 * 86400000),
          confirmedAt: startAt,
          subtotal: "1000",
          discountTotal: "0",
          taxTotal: "180",
          total: "1180",
          snapshot: json(snapshot),
          snapshotHash: digest(snapshot),
        })),
      });
      await db.invoiceLine.createMany({
        data: subs.map((s) => ({
          invoiceId: `${s.id}-invoice-${month}`,
          description: "Benchmark CRM",
          quantity: "1",
          unitPrice: "1000",
          subtotal: "1000",
          discount: "0",
          tax: "180",
          total: "1180",
          details: json(expected.lines[0]),
        })),
      });
      const paid = subs.filter((_, i) => i % 3 !== 0);
      await db.payment.createMany({
        data: paid.map((s) => ({
          id: `${s.id}-payment-${month}`,
          customerId: s.customerId,
          reference: `BENCH-PAY-${s.id}-${month}`,
          amount: "1180",
          currency: "INR",
          method: "BANK_TRANSFER",
          receivedAt: startAt,
          recordedBy: "benchmark",
        })),
      });
      await db.allocation.createMany({
        data: paid.map((s) => ({
          paymentId: `${s.id}-payment-${month}`,
          invoiceId: `${s.id}-invoice-${month}`,
          amount: "1180",
        })),
      });
    }
  }
  await db.setting.create({
    data: {
      key: "benchmark-seeded",
      value: { subscriptions: 5000, invoices: 20000 },
    },
  });
}
await db.$executeRaw`ANALYZE`;
const { account } = await import("../support.js");
const user = await account("FINANCE");
const endpoints = [
  "/subscriptions?limit=25",
  "/invoices?limit=25",
  "/customers?limit=25",
  "/reports/dashboard",
];
const measurements: {
  endpoint: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}[] = [];
for (const endpoint of endpoints) {
  for (let i = 0; i < 3; i++) await user.get(endpoint).expect(200);
  const times: number[] = [];
  // 5 concurrent users × 10 requests; cookie/session checks are included.
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await user.get(endpoint).expect(200);
        times.push(performance.now() - start);
      }
    }),
  );
  times.sort((a, b) => a - b);
  measurements.push({
    endpoint,
    samples: times.length,
    p50Ms: Math.round(times[Math.floor(times.length * 0.5)]!),
    p95Ms: Math.round(times[Math.ceil(times.length * 0.95) - 1]!),
    maxMs: Math.round(times.at(-1)!),
  });
}
const queryPlan =
  await db.$queryRaw`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM "Subscription" WHERE status='ACTIVE' ORDER BY "nextBillingAt" LIMIT 100`;
const report = {
  at: new Date().toISOString(),
  machine: {
    platform: os.platform(),
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
  },
  dataset: {
    subscriptions: await db.subscription.count({
      where: { id: { startsWith: "bench-sub-" } },
    }),
    invoices: await db.invoice.count({
      where: { id: { startsWith: "bench-sub-" } },
    }),
    customers: 1000,
  },
  workload:
    "Local Express/Supertest with real PostgreSQL, 3 warmups then 50 requests per endpoint at concurrency 5; excludes browser paint and external network",
  measurements,
  queryPlan,
};
await mkdir("docs/testing", { recursive: true });
await writeFile(
  "docs/testing/performance-results.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({ ...report, queryPlan: "Recorded in report" }, null, 2),
);
await db.$disconnect();
if (measurements.some((m) => m.p95Ms >= 2000)) process.exitCode = 1;
