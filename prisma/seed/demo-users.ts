import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import argon2 from "argon2";
import { DateTime } from "luxon";
import { z } from "zod";
import { auth } from "../../apps/api/src/auth.js";
import { config } from "../../apps/api/src/config.js";
import { audit, db, digest, json, lock, outbox, transaction } from "../../apps/api/src/db.js";
import { billOne } from "../../apps/api/src/modules/billing.js";
import { recordPayment } from "../../apps/api/src/modules/finance.js";
import { contract, createQuote } from "../../apps/api/src/modules/sales.js";
import { calculateBill, D, money, type BillInput } from "../../packages/billing-engine/src/index.js";
import { totp } from "../../scripts/totp.js";

export const demoRoles = ["ADMIN", "CUSTOMER", "SALES", "FINANCE", "SUPPORT"] as const;
const credentialSchema = z.object({
  createdAt: z.string(),
  password: z.string(),
  accounts: z.array(z.object({
    id: z.string(), email: z.email(), password: z.string(),
    role: z.enum(demoRoles), name: z.string(),
    totpSecret: z.string().optional(), backupCodes: z.array(z.string()).optional(),
  })),
});
export type DemoCredentials = z.infer<typeof credentialSchema>;
export const demoCredentialsPath = ".local/hackathon-demo-credentials.json";
const fixtureKey = "hackathon-demo-fixtures-v1";

function developmentOnly() {
  if (config.NODE_ENV === "production")
    throw new Error("Demo account provisioning is forbidden in production");
}
async function saveCredentials(path: string, data: DemoCredentials) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function cookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

/** Reconcile these development accounts before the original seed's early return. */
export async function ensureHackathonDemoUsers(path = demoCredentialsPath) {
  developmentOnly();
  let credentials: DemoCredentials;
  try {
    credentials = credentialSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    credentials = {
      createdAt: new Date().toISOString(),
      password: `Demo!${randomBytes(4).toString("hex")}`,
      accounts: [],
    };
    // Persist first so an interrupted seed can reuse the same generated password.
    await saveCredentials(path, credentials);
  }
  for (const role of demoRoles) {
    const email = `${role.toLowerCase()}@brightloop.demo`;
    let saved = credentials.accounts.find((account) => account.email === email);
    let user = await db.user.findUnique({ where: { email } });
    if (user) {
      const account = await db.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
      if (!account?.password || !(await argon2.verify(account.password, credentials.password)))
        throw new Error(`Preserved the existing password for ${email}. Use the existing password-reset flow before provisioning this demo account again.`);
    } else {
      const result = await auth.api.signUpEmail({
        body: {
          email, password: credentials.password,
          name: role === "CUSTOMER" ? "Brightloop Demo Customer" : `${role[0]}${role.slice(1).toLowerCase()} Demo`,
        },
      });
      user = await db.user.findUniqueOrThrow({ where: { id: result.user.id } });
    }
    await transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { role, emailVerified: true, suspended: false } });
      const customer = await tx.customer.findUnique({ where: { email } });
      if (customer && customer.userId && customer.userId !== user.id)
        throw new Error(`Customer ownership conflict for ${email}; no ownership was changed.`);
      await tx.customer.upsert({
        where: { email },
        create: { userId: user.id, email, name: user.name, active: true },
        update: { userId: user.id, active: true },
      });
    });
    if (!saved) {
      saved = { id: user.id, email, password: credentials.password, role, name: user.name };
      credentials.accounts.push(saved);
    }
    Object.assign(saved, { id: user.id, password: credentials.password, role, name: user.name });
    await saveCredentials(path, credentials);
    if (role === "ADMIN" || role === "FINANCE") {
      if (user.twoFactorEnabled && !saved.totpSecret)
        throw new Error(`Preserved existing MFA for ${email}. Restore its local authenticator secret or use the existing reviewed account-recovery flow.`);
      if (!user.twoFactorEnabled) {
        const login = await auth.api.signInEmail({ body: { email, password: credentials.password }, asResponse: true });
        if (login.status !== 200) throw new Error(`Could not authenticate ${email} for MFA enrollment`);
        const headers = new Headers({ cookie: cookies(login), origin: config.WEB_ORIGIN });
        // An interrupted enrollment may have saved its secret before verification.
        // Verify that existing factor instead of replacing it with a new secret.
        if (!saved.totpSecret) {
          const setup = await auth.api.enableTwoFactor({ headers, body: { password: credentials.password } });
          if (setup.method !== "totp") throw new Error("Expected authenticator enrollment");
          saved.totpSecret = new URL(setup.totpURI).searchParams.get("secret")!;
          saved.backupCodes = setup.backupCodes;
          await saveCredentials(path, credentials);
        }
        const verified = await auth.api.verifyTOTP({ headers, body: { code: totp(saved.totpSecret) }, asResponse: true });
        if (verified.status !== 200) throw new Error(`Could not verify MFA enrollment for ${email}`);
      }
    }
  }
  if (path === demoCredentialsPath) {
    await writeFile(".local/hackathon-demo-login.txt", [
      "Brightloop SubscriptionOS — LOCAL DEVELOPMENT DEMO ONLY",
      "Sign in at http://localhost:5173",
      `Shared temporary password: ${credentials.password}`,
      ...credentials.accounts.map((account) => `${account.role}: ${account.email}`),
      "Admin and Finance also require a current authenticator code:",
      "npm.cmd run demo:otp -- --hackathon admin",
      "npm.cmd run demo:otp -- --hackathon finance",
      "All passwords and authenticator secrets stay in ignored .local files.",
      "",
    ].join("\n"), { mode: 0o600 });
  }
  return credentials;
}

/** Real local ledger fixtures; stable identifiers make interrupted runs repeatable. */
export async function seedHackathonDemoFixtures(credentials: DemoCredentials) {
  developmentOnly();
  if (await db.setting.findUnique({ where: { key: fixtureKey } })) return;
  const admin = credentials.accounts.find((account) => account.role === "ADMIN")!;
  const finance = credentials.accounts.find((account) => account.role === "FINANCE")!;
  const sales = credentials.accounts.find((account) => account.role === "SALES")!;
  const customerAccount = credentials.accounts.find((account) => account.role === "CUSTOMER")!;
  const customer = await db.customer.findUniqueOrThrow({ where: { userId: customerAccount.id } });
  await db.customer.update({
    where: { id: customer.id }, data: {
      company: "Brightloop Demo Studio", billingAddress: "42 Residency Road, Bengaluru, Karnataka 560025",
      notes: "Hackathon demonstration account. All seeded receipts are local simulations; no external money moved.",
    }
  });
  const ids = {
    product: "92a25f76-4a93-4e42-a145-000000000001",
    basic: "92a25f76-4a93-4e42-a145-000000000002",
    pro: "92a25f76-4a93-4e42-a145-000000000003",
    basicVersion: "92a25f76-4a93-4e42-a145-000000000004",
    proVersion: "92a25f76-4a93-4e42-a145-000000000005",
  };
  const basic = await transaction(async (tx) => {
    await lock(tx, fixtureKey);
    const tax = await tx.tax.findFirst({ where: { active: true, endsAt: null }, orderBy: { startsAt: "asc" } });
    await tx.product.upsert({
      where: { id: ids.product }, update: {}, create: {
        id: ids.product, name: "Brightloop Workspace", description: "Connected workspace with compatible Basic and Pro subscriptions.", salesPrice: "999", currency: "INR",
      }
    });
    for (const [name, planId, versionId, price, seats] of [
      ["Basic", ids.basic, ids.basicVersion, "999", 5],
      ["Pro", ids.pro, ids.proVersion, "1999", 25],
    ] as const) {
      await tx.plan.upsert({
        where: { id: planId }, update: {}, create: {
          id: planId, name, productId: ids.product,
          description: `${name} monthly workspace plan for the hackathon demo.`,
        }
      });
      await tx.planVersion.upsert({
        where: { id: versionId }, update: {}, create: {
          id: versionId, planId, price, interval: "MONTHLY", currency: "INR", taxId: tax?.id,
          effectiveAt: new Date("2020-01-01T00:00:00Z"),
          entitlements: { seats, analytics: true, prioritySupport: name === "Pro" },
        }
      });
    }
    return tx.planVersion.findUniqueOrThrow({ where: { id: ids.basicVersion }, include: { tax: true } });
  });
  const subscription = await transaction(async (tx) => {
    await lock(tx, fixtureKey);
    const startAt = DateTime.now().setZone("Asia/Kolkata").startOf("month").minus({ months: 3 }).toJSDate();
    return tx.subscription.upsert({
      where: { number: "SUB-DEMO-HACKATHON-BASIC" }, update: {}, create: {
        number: "SUB-DEMO-HACKATHON-BASIC", customerId: customer.id, status: "ACTIVE", interval: "MONTHLY",
        startAt, nextBillingAt: startAt, anchorDay: 1,
        items: {
          create: {
            planVersionId: basic.id, description: "Brightloop Workspace · Basic", quantity: 1, unitPrice: basic.price,
            snapshot: json({ ...contract(basic), productId: ids.product }),
          }
        },
        events: { create: { action: "ACTIVATED", actorId: admin.id, data: { demo: true } } },
      },
    });
  });
  for (let i = await db.invoice.count({ where: { subscriptionId: subscription.id } }); i < 4; i++) {
    const result = await billOne(subscription.id, new Date(), admin.id);
    if (!result.created) throw new Error("Could not create the demo subscription billing period");
  }
  const invoices = await db.invoice.findMany({ where: { subscriptionId: subscription.id }, orderBy: { period: { startAt: "asc" } } });
  for (let index = 0; index < Math.min(3, invoices.length); index++) {
    const invoice = invoices[index]!;
    if (invoice.status === "DRAFT") await transaction(async (tx) => {
      await lock(tx, `invoice:${invoice.id}`);
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true } });
      if (current.status !== "DRAFT") return;
      const expected = calculateBill((current.snapshot as { input: BillInput }).input);
      if (digest(current.snapshot) !== current.snapshotHash || !D(current.total.toString()).eq(expected.total))
        throw new Error("Demo invoice failed ProofBill verification");
      const dueAt = DateTime.fromJSDate(subscription.createdAt).plus({ days: index === 2 ? -2 : index === 1 ? 7 : -60 }).toJSDate();
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), dueAt } });
      await audit(tx, finance.id, "INVOICE_CONFIRMED", invoice.id, { demo: true });
      await outbox(tx, `invoice:${invoice.id}`, customer.email, `Invoice ${invoice.number}`, {
        text: `DEMO MODE: Invoice ${invoice.number} is ready in your portal. This is a hackathon billing fixture.`,
      });
    });
    if (index < 2) {
      const reference = `DEMO-HACKATHON-${index === 0 ? "PAID" : "PARTIAL"}`;
      if (!(await db.payment.findUnique({ where: { reference } }))) {
        const allocation = index === 0 ? money(invoice.total.toString()) : money(D(invoice.total.toString()).div(2));
        await recordPayment({
          customerId: customer.id, reference,
          amount: index === 0 ? allocation : money(D(allocation).plus(100)),
          currency: "INR", method: "OTHER", receivedAt: new Date(),
          notes: "DEMO MODE: Local simulated manual receipt for the hackathon. No external payment or money transfer occurred.",
          allocations: [{ invoiceId: invoice.id, amount: allocation }],
        }, { id: finance.id, role: "FINANCE", customerId: null }, `hackathon-fixture-payment-${index}`);
      }
    }
  }
  await transaction(async (tx) => {
    await lock(tx, fixtureKey);
    const old = await tx.quote.findUnique({ where: { number: "QUO-DEMO-HACKATHON-PRO" } });
    if (!old) {
      const template = await tx.quoteTemplate.findFirst({ orderBy: { createdAt: "asc" } });
      const quote = await createQuote(tx, {
        customerId: customer.id, templateId: template?.id,
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        terms: "DEMO MODE: Prepared Pro upgrade quotation. No external payment is taken.",
        lines: [{ planVersionId: ids.proVersion, quantity: 1, addonIds: [] }],
      }, sales.id);
      await tx.quote.update({ where: { id: quote.id }, data: { number: "QUO-DEMO-HACKATHON-PRO", status: "SENT" } });
      await audit(tx, sales.id, "QUOTE_SENT", quote.id, { demo: true });
    }
    await tx.setting.upsert({
      where: { key: fixtureKey }, update: {}, create: {
        key: fixtureKey, value: { at: new Date().toISOString(), customerId: customer.id, subscriptionId: subscription.id },
      }
    });
    await audit(tx, admin.id, "HACKATHON_DEMO_SEEDED", customer.id);
  });
}
