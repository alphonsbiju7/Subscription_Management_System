import request from "supertest";
import { randomBytes, randomUUID } from "node:crypto";
import { createApp } from "../apps/api/src/app.js";
import { auth } from "../apps/api/src/auth.js";
import { db } from "../apps/api/src/db.js";
import { config } from "../apps/api/src/config.js";
import { totp } from "../scripts/totp.js";
import type { Role } from "@prisma/client";
export const app = createApp();
export async function account(
  role: Role,
  mfa = ["ADMIN", "FINANCE"].includes(role),
) {
  const email = `test-${randomUUID()}@example.test`,
    password = `Test!Aa${randomBytes(16).toString("hex")}`;
  const result = await auth.api.signUpEmail({
    body: { name: `Test ${role}`, email, password },
  });
  await db.user.update({
    where: { id: result.user.id },
    data: { role, emailVerified: true },
  });
  const agent = request.agent(app);
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  // Provisioning bypasses the HTTP login limiter; dedicated security tests exercise it separately.
  agent.jar.setCookies(login.headers.getSetCookie(), "127.0.0.1", "/");
  let secret: string | undefined;
  if (mfa) {
    const headers = new Headers({
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
      origin: config.WEB_ORIGIN,
    });
    const setup = await auth.api.enableTwoFactor({
      headers,
      body: { password },
    });
    if (setup.method !== "totp") throw new Error("Expected TOTP");
    secret = new URL(setup.totpURI).searchParams.get("secret")!;
    const verified = await auth.api.verifyTOTP({
      headers,
      body: { code: totp(secret) },
      asResponse: true,
    });
    if (verified.status !== 200)
      throw new Error("MFA test provisioning failed");
    agent.jar.setCookies(verified.headers.getSetCookie(), "127.0.0.1", "/");
  }
  const customer = await db.customer.findUniqueOrThrow({
    where: { userId: result.user.id },
  });
  return {
    agent,
    email,
    password,
    id: result.user.id,
    customerId: customer.id,
    secret,
    post: (path: string, body: object) =>
      agent
        .post(`/api/v1${path}`)
        .set("Origin", config.WEB_ORIGIN)
        .set("Idempotency-Key", randomUUID())
        .send(body),
    get: (path: string) => agent.get(`/api/v1${path}`),
  };
}
export async function fixture(
  admin: Awaited<ReturnType<typeof account>>,
  customerId: string,
  options: {
    price?: string;
    interval?: string;
    usage?: boolean;
    discountId?: string;
  } = {},
) {
  const product = await admin
    .post("/products", {
      name: `Test Product ${randomUUID()}`,
      salesPrice: options.price ?? "1000",
    })
    .expect(201);
  const plan = await admin
    .post("/plans", {
      productId: product.body.id,
      name: "Test Plan",
      price: options.price ?? "1000",
      interval: options.interval ?? "MONTHLY",
      pricingModel: options.usage ? "HYBRID" : "PER_SEAT",
      usageRate: options.usage ? "0.1" : "0",
      includedUsage: options.usage ? "100" : "0",
    })
    .expect(201);
  const quote = await admin
    .post("/quotes", {
      customerId,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      discountId: options.discountId,
      lines: [{ planVersionId: plan.body.versions[0].id, quantity: 1 }],
    })
    .expect(201);
  await admin.post(`/quotes/${quote.body.id}/send`, {}).expect(200);
  const sub = await admin
    .post(`/quotes/${quote.body.id}/accept`, {})
    .expect(200);
  await admin
    .post(`/subscriptions/${sub.body.id}/action`, { action: "activate" })
    .expect(200);
  return {
    product: product.body as { id: string },
    plan: plan.body as { id: string; versions: { id: string }[] },
    quote: quote.body as { id: string },
    sub: sub.body as { id: string },
  };
}
