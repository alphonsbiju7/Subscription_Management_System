import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db, transaction, json, number, audit } from "../../apps/api/src/db.js";
import { auth } from "../../apps/api/src/auth.js";
import { config } from "../../apps/api/src/config.js";
import { contract } from "../../apps/api/src/modules/sales.js";
import { billOne } from "../../apps/api/src/modules/billing.js";
import { recordPayment } from "../../apps/api/src/modules/finance.js";
import { DateTime } from "luxon";
import { totp } from "../../scripts/totp.js";
import type { Role } from "@prisma/client";
import { money, D } from "../../packages/billing-engine/src/index.js";
import { ensureHackathonDemoUsers, seedHackathonDemoFixtures } from "./demo-users.js";
if (config.NODE_ENV === "production")
  throw new Error("Demo seed is forbidden in production");
const hackathonDemo = await ensureHackathonDemoUsers();
if (await db.setting.findUnique({ where: { key: "demo-seeded" } })) {
  await seedHackathonDemoFixtures(hackathonDemo);
  console.log(
    "Demo data already exists. Original credentials remain in .local/demo-credentials.json; five-role demo credentials are in .local/hackathon-demo-login.txt.",
  );
  await db.$disconnect();
  process.exit(0);
}
const accounts: {
  email: string;
  password: string;
  role: Role;
  name: string;
  id: string;
  totpSecret?: string;
  backupCodes?: string[];
}[] = [];
function cookieOf(r: Response) {
  return r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
for (const role of [
  "ADMIN",
  "SALES",
  "FINANCE",
  "SUPPORT",
  "CUSTOMER",
  "CUSTOMER",
] as Role[]) {
  const suffix =
    role === "CUSTOMER"
      ? String(accounts.filter((a) => a.role === "CUSTOMER").length + 1)
      : "";
  const email = `${role.toLowerCase()}${suffix}@brightloop.local`,
    password = `Bl!${randomBytes(20).toString("base64url")}aA`;
  const name =
    role === "CUSTOMER"
      ? suffix === "1"
        ? "Ananya Rao"
        : "James Wilson"
      : `${role.charAt(0)}${role.slice(1).toLowerCase()} Operator`;
  const result = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  await db.user.update({
    where: { id: result.user.id },
    data: { role, emailVerified: true },
  });
  const item: (typeof accounts)[number] = {
    email,
    password,
    role,
    name,
    id: result.user.id,
  };
  if (["ADMIN", "FINANCE"].includes(role)) {
    const login = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const headers = new Headers({
      cookie: cookieOf(login),
      origin: config.WEB_ORIGIN,
    });
    const enabled = await auth.api.enableTwoFactor({
      headers,
      body: { password },
    });
    if (enabled.method !== "totp")
      throw new Error("Expected authenticator enrollment");
    const secret = new URL(enabled.totpURI!).searchParams.get("secret")!;
    await auth.api.verifyTOTP({ headers, body: { code: totp(secret) } });
    item.totpSecret = secret;
    item.backupCodes = enabled.backupCodes;
  }
  accounts.push(item);
}
const customer1 = await db.customer.findUniqueOrThrow({
  where: { userId: accounts[4]!.id },
});
const customer2 = await db.customer.findUniqueOrThrow({
  where: { userId: accounts[5]!.id },
});
await db.customer.update({
  where: { id: customer1.id },
  data: {
    company: "Acme Studio",
    billingAddress: "42 Residency Road, Bengaluru, Karnataka 560025",
    taxId: "DEMO-GST-001",
  },
});
await db.customer.update({
  where: { id: customer2.id },
  data: {
    company: "Northstar Labs",
    billingAddress: "17 MG Road, Kochi, Kerala 682016",
  },
});
const companies = [
  "Nimbus Technologies",
  "Meridian Retail",
  "Pinecone Digital",
  "Arbor Systems",
  "Coastline Studio",
  "Kite Analytics",
  "Saffron Design",
  "Vertex Media",
];
const allCustomers = [customer1, customer2];
for (let i = 0; i < companies.length; i++)
  allCustomers.push(
    await db.customer.create({
      data: {
        number: number("CUS"),
        name: companies[i]!,
        company: companies[i]!,
        email: `billing${i}@example.test`,
        billingAddress: "India",
        paymentTerms: 14,
      },
    }),
  );
const tax = await db.tax.create({
  data: {
    name: "GST 18% (illustrative)",
    components: [
      { name: "CGST", rate: "9" },
      { name: "SGST", rate: "9" },
    ],
    startsAt: new Date("2020-01-01T00:00:00Z"),
  },
});
const products = [];
for (const [name, description, price] of [
  ["Brightloop CRM", "A connected sales workspace for growing teams.", "1499"],
  ["Brightloop Projects", "Projects, people and deadlines in sync.", "899"],
  [
    "Brightloop AI API",
    "Intelligent API services with usage-based billing.",
    "2499",
  ],
  [
    "Brightloop Finance",
    "Financial operations for ambitious businesses.",
    "3999",
  ],
])
  products.push(
    await db.product.create({
      data: {
        name: name!,
        description: description!,
        salesPrice: price!,
        costPrice: "200",
        currency: "INR",
        variants: {
          create: [
            {
              name: "Standard",
              sku: `BL-${products.length}-STD`,
              priceAdjustment: "0",
            },
            {
              name: "Odoo",
              sku: `BL-${products.length}-ODOO`,
              priceAdjustment: "560",
            },
          ],
        },
        addons: {
          create: [
            { name: "Priority support", price: "299" },
            { name: "Onboarding assistance", price: "499" },
          ],
        },
      },
    }),
  );
const versions = [];
const intervals = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
for (let i = 0; i < products.length; i++) {
  const product = products[i]!;
  for (const interval of intervals) {
    const price =
      interval === "DAILY"
        ? "99"
        : interval === "WEEKLY"
          ? "499"
          : interval === "YEARLY"
            ? D(product.salesPrice.toString()).mul(10).toString()
            : product.salesPrice.toString();
    const plan = await db.plan.create({
      data: {
        name: `${["Starter", "Team", "Intelligence", "Business"][i]} ${interval.toLowerCase()}`,
        description: product.description,
        productId: product.id,
        versions: {
          create: {
            interval,
            price,
            currency: "INR",
            taxId: tax.id,
            pricingModel: i === 2 ? "HYBRID" : "PER_SEAT",
            usageRate: i === 2 ? "0.12" : "0",
            includedUsage: i === 2 ? "1000" : "0",
            entitlements: {
              seats: 10,
              apiCalls: i === 2 ? 1000 : 0,
              analytics: true,
            },
            effectiveAt: new Date("2020-01-01T00:00:00Z"),
          },
        },
      },
      include: { versions: { include: { tax: true } } },
    });
    versions.push({ version: plan.versions[0]!, product, plan });
  }
}
await db.quoteTemplate.createMany({
  data: [
    {
      name: "Standard subscription",
      terms:
        "Payment within 14 days. Taxes are illustrative. Recurring charges follow the agreed plan interval. Cancellation takes effect at a billing boundary.",
      validityDays: 30,
    },
    {
      name: "Enterprise annual agreement",
      terms:
        "Annual subscription. Contract changes require a revised agreement. Usage is invoiced in arrears.",
      validityDays: 45,
    },
  ],
});
const discount = await db.discount.create({
  data: {
    code: "WELCOME10",
    type: "PERCENT",
    value: "10",
    minimum: "0",
    startsAt: new Date(Date.now() - 365 * 86400000),
    endsAt: new Date(Date.now() + 90 * 86400000),
    usageLimit: 1000,
  },
});
await db.discount.create({
  data: {
    code: "EXPIRED20",
    type: "PERCENT",
    value: "20",
    minimum: "0",
    startsAt: new Date("2020-01-01"),
    endsAt: new Date("2021-01-01"),
    usageLimit: 10,
  },
});
const meter = await db.usageMeter.create({
  data: { key: "api_calls", name: "AI API calls", unit: "requests" },
});
const admin = accounts[0]!,
  fin = accounts[2]!;
const monthly = versions.filter((v) => v.version.interval === "MONTHLY");
let invoiceIndex = 0;
for (let i = 0; i < 12; i++) {
  const selected = monthly[i % monthly.length]!,
    customer = allCustomers[i % allCustomers.length]!;
  const startAt = DateTime.now()
    .setZone("Asia/Kolkata")
    .startOf("day")
    .minus({ months: 3 })
    .plus({ days: i % 5 })
    .toJSDate();
  const sub = await db.subscription.create({
    data: {
      number: number("SUB"),
      customerId: customer.id,
      status: "ACTIVE",
      interval: "MONTHLY",
      startAt,
      nextBillingAt: startAt,
      anchorDay: DateTime.fromJSDate(startAt, { zone: "Asia/Kolkata" }).day,
      discountId: i === 0 ? discount.id : null,
      items: {
        create: {
          planVersionId: selected.version.id,
          description: `${selected.product.name} · ${selected.plan.name}`,
          quantity: (i % 3) + 1,
          unitPrice: selected.version.price,
          snapshot: json({
            ...contract(selected.version),
            productId: selected.product.id,
          }),
        },
      },
      events: {
        create: {
          action: "ACTIVATED",
          actorId: admin.id,
          data: { seed: true },
        },
      },
    },
  });
  if (i === 10) {
    await db.subscription.update({
      where: { id: sub.id },
      data: { status: "PAUSED" },
    });
    continue;
  }
  if (i === 11) {
    await db.subscription.update({
      where: { id: sub.id },
      data: { status: "CLOSED", endAt: startAt },
    });
    continue;
  }
  if (i === 9) continue; // Authentic missing-invoice fixture, repairable by the billing worker.
  for (let p = 0; p < 3; p++) {
    const result = await billOne(sub.id, new Date());
    if (!result.created || !result.invoiceId) break;
    const invoice = await db.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
    });
    const issuedAt = DateTime.fromJSDate(startAt)
      .plus({ months: p })
      .toJSDate();
    // Still a draft: set dates for a consistent historical demo before confirmation.
    if (i === 7 && p === 2) {
      await db.invoice.update({
        where: { id: invoice.id },
        data: { total: D(invoice.total.toString()).plus(100).toString() },
      });
      continue;
    }
    if (i === 8 && p === 2) {
      await db.invoice.update({
        where: { id: invoice.id },
        data: { total: D(invoice.total.toString()).minus(100).toString() },
      });
      continue;
    }
    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        issuedAt,
        dueAt: new Date(issuedAt.getTime() + 14 * 86400000),
        status: "CONFIRMED",
        confirmedAt: issuedAt,
      },
    });
    if ((i + p) % 4 !== 0)
      await recordPayment(
        {
          customerId: customer.id,
          reference: `SEED-${invoiceIndex++}`,
          amount:
            (i + p) % 4 === 1
              ? money(D(invoice.total.toString()).div(2))
              : money(invoice.total.toString()),
          currency: "INR",
          method: "BANK_TRANSFER",
          receivedAt: issuedAt,
          notes: "Development fixture",
          allocations: [
            {
              invoiceId: invoice.id,
              amount:
                (i + p) % 4 === 1
                  ? money(D(invoice.total.toString()).div(2))
                  : money(invoice.total.toString()),
            },
          ],
        },
        { id: fin.id, role: "FINANCE", customerId: null },
        `seed-${invoice.id}`,
      );
  }
  if (i === 2)
    await db.usageEvent.create({
      data: {
        eventId: "seed-ai-usage-0001",
        subscriptionId: sub.id,
        meterId: meter.id,
        quantity: "3500",
        occurredAt: new Date(Date.now() - 86400000),
      },
    });
}
const template = await db.quoteTemplate.findFirstOrThrow();
for (let i = 0; i < 3; i++) {
  const selected = monthly[i]!;
  await db.quote.create({
    data: {
      number: number("QUO"),
      customerId: allCustomers[i]!.id,
      status: i === 2 ? "EXPIRED" : "SENT",
      validUntil: new Date(Date.now() + (i === 2 ? -2 : 30) * 86400000),
      terms: template.terms,
      lines: {
        create: {
          planVersionId: selected.version.id,
          description: selected.product.name,
          quantity: 1,
          unitPrice: selected.version.price,
          snapshot: json({
            ...contract(selected.version),
            productId: selected.product.id,
          }),
        },
      },
    },
  });
}
const approved = await db.adjustment.create({
  data: {
    customerId: customer1.id,
    kind: "PREPAID",
    amount: "500",
    currency: "INR",
    reason: "Development prepaid allowance",
    requestedBy: fin.id,
    approvedBy: admin.id,
    status: "APPROVED",
    decidedAt: new Date(),
  },
});
await db.creditEntry.create({
  data: {
    customerId: customer1.id,
    adjustmentId: approved.id,
    currency: "INR",
    amount: "500",
    reason: approved.reason,
    expiresAt: new Date(Date.now() + 365 * 86400000),
  },
});
await db.adjustment.create({
  data: {
    customerId: customer2.id,
    kind: "CREDIT_NOTE",
    amount: "250",
    currency: "INR",
    reason: "Customer service credit awaiting independent approval",
    requestedBy: fin.id,
  },
});
await transaction(async (tx) => {
  await tx.setting.upsert({
    where: { key: "business" },
    create: {
      key: "business",
      value: {
        companyName: "Brightloop Software",
        supportEmail: "support@brightloop.local",
        graceDays: 14,
        reminderDays: [1, 3, 7, 14],
        renewalNoticeDays: 7,
      },
    },
    update: {},
  });
  await tx.setting.create({
    data: { key: "demo-seeded", value: { at: new Date().toISOString() } },
  });
  await audit(tx, admin.id, "DEMO_SEEDED", "development");
});
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/demo-credentials.json",
  JSON.stringify({ createdAt: new Date().toISOString(), accounts }, null, 2),
  { mode: 0o600 },
);
console.log(
  "Seeded database. Random credentials and demo authenticator secrets are in ignored .local/demo-credentials.json. Use npm run demo:otp -- admin or finance for a current code.",
);
await seedHackathonDemoFixtures(hackathonDemo);
await db.$disconnect();
