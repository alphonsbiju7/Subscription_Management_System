import { readFile } from "node:fs/promises";
import argon2 from "argon2";
import { expect, it } from "vitest";
import { db, digest } from "../../apps/api/src/db.js";
import { config } from "../../apps/api/src/config.js";
import { ensureHackathonDemoUsers, seedHackathonDemoFixtures, demoRoles } from "../../prisma/seed/demo-users.js";

it("provisions all demo roles with real hashes and MFA, and never duplicates accounts or financial fixtures", async () => {
  // Stable, ignored credentials allow rerunning against the same integration DB.
  const path = process.env.DEMO_SEED_TEST_CREDENTIALS_PATH ?? `.local/integration-demo-${digest(config.DATABASE_URL).slice(0, 12)}.json`;
  const credentials = await ensureHackathonDemoUsers(path);
  expect(credentials.accounts.map((account) => account.role)).toEqual([...demoRoles]);
  expect(credentials.accounts.every((account) => account.password === credentials.password)).toBe(true);
  const emails = credentials.accounts.map((account) => account.email);
  const users = await db.user.findMany({ where: { email: { in: emails } }, include: { accounts: true, twoFactors: true, customer: true } });
  expect(users).toHaveLength(5);
  for (const user of users) {
    expect(user.role.toLowerCase()).toBe(user.email.split("@")[0]);
    expect(user.emailVerified).toBe(true);
    expect(user.suspended).toBe(false);
    expect(user.customer?.active).toBe(true);
    const hash = user.accounts.find((account) => account.providerId === "credential")?.password;
    expect(hash?.startsWith("$argon2id$")).toBe(true);
    expect(await argon2.verify(hash!, credentials.password)).toBe(true);
    if (user.role === "ADMIN" || user.role === "FINANCE") {
      expect(user.twoFactorEnabled).toBe(true);
      expect(user.twoFactors.some((factor) => factor.verified)).toBe(true);
      expect(Boolean(credentials.accounts.find((account) => account.id === user.id)?.totpSecret)).toBe(true);
    }
  }
  await seedHackathonDemoFixtures(credentials);
  const customer = users.find((user) => user.role === "CUSTOMER")!.customer!;
  const subscription = await db.subscription.findUniqueOrThrow({
    where: { number: "SUB-DEMO-HACKATHON-BASIC" },
    include: { items: { include: { planVersion: { include: { plan: true } } } }, invoices: { include: { allocations: true } } },
  });
  expect(subscription.customerId).toBe(customer.id);
  expect(subscription.status).toBe("ACTIVE");
  expect(subscription.items[0]!.planVersion.plan.name).toBe("Basic");
  expect(subscription.invoices).toHaveLength(4);
  expect(subscription.invoices.filter((invoice) => invoice.status === "DRAFT")).toHaveLength(1);
  expect(subscription.invoices.filter((invoice) => invoice.status === "CONFIRMED")).toHaveLength(3);
  expect(subscription.invoices.some((invoice) => invoice.status === "CONFIRMED" && invoice.dueAt < new Date() && !invoice.allocations.length)).toBe(true);
  const quote = await db.quote.findUniqueOrThrow({ where: { number: "QUO-DEMO-HACKATHON-PRO" }, include: { lines: { include: { planVersion: { include: { plan: true } } } } } });
  expect(quote.status).toBe("SENT");
  expect(quote.customerId).toBe(customer.id);
  expect(quote.lines[0]!.planVersion.plan.name).toBe("Pro");
  expect(quote.lines[0]!.planVersion.plan.productId).toBe(subscription.items[0]!.planVersion.plan.productId);
  expect(quote.lines[0]!.planVersion.interval).toBe(subscription.interval);
  const payments = await db.payment.findMany({ where: { customerId: customer.id }, include: { allocations: true } });
  expect(payments).toHaveLength(2);
  expect(payments.every((payment) => payment.notes.includes("DEMO MODE") && payment.method === "OTHER")).toBe(true);
  expect(payments.some((payment) => Number(payment.amount) > payment.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0))).toBe(true);
  const originalHashes = users.flatMap((user) => user.accounts.map((account) => account.password));
  await ensureHackathonDemoUsers(path);
  await seedHackathonDemoFixtures(credentials);
  expect(await db.user.count({ where: { email: { in: emails } } })).toBe(5);
  const after = await db.user.findMany({ where: { email: { in: emails } }, include: { accounts: true }, orderBy: { email: "asc" } });
  expect(after.flatMap((user) => user.accounts.map((account) => account.password)).every((hash) => originalHashes.includes(hash))).toBe(true);
  expect(await db.invoice.count({ where: { customerId: customer.id } })).toBe(4);
  expect(await db.payment.count({ where: { customerId: customer.id } })).toBe(2);
  expect(await db.quote.count({ where: { number: "QUO-DEMO-HACKATHON-PRO" } })).toBe(1);
  expect(JSON.parse(await readFile(path, "utf8")).accounts).toHaveLength(5);
});
