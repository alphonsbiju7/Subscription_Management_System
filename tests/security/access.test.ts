import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { account, app, fixture } from "../support.js";
import { billOne } from "../../apps/api/src/modules/billing.js";
import { db, digest } from "../../apps/api/src/db.js";
import { config } from "../../apps/api/src/config.js";
import { safeRequestPath } from "../../apps/api/src/app.js";
let admin: Awaited<ReturnType<typeof account>>,
  alice: Awaited<ReturnType<typeof account>>,
  bob: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  admin = await account("ADMIN");
  alice = await account("CUSTOMER");
  bob = await account("CUSTOMER");
});
describe("authorization and tampering", () => {
  it("redacts recovery tokens from request log paths", () => {
    expect(
      safeRequestPath("/api/auth/reset-password/private-recovery-token"),
    ).toBe("/api/auth/reset-password/:token");
    expect(safeRequestPath("/api/auth/reset-password/private-recovery-token/")).toBe("/api/auth/reset-password/:token");
    expect(safeRequestPath("/api/v1/invoices/example")).toBe(
      "/api/v1/invoices/example",
    );
  });
  it("denies unauthenticated and invalid-cookie access", async () => {
    await request(app).get("/api/v1/invoices").expect(401);
    await request(app)
      .get("/api/v1/staff")
      .set("Cookie", "better-auth.session_token=invalid")
      .expect(401);
  });
  it("isolates invoice, PDF, subscriptions, quotes and customer profiles", async () => {
    const f = await fixture(admin, bob.customerId),
      invoice = await billOne(f.sub.id);
    await alice.get(`/invoices/${invoice.invoiceId}`).expect(404);
    await alice.get(`/invoices/${invoice.invoiceId}/pdf`).expect(404);
    await alice.get(`/subscriptions/${f.sub.id}`).expect(404);
    await alice.get(`/subscriptions/${f.sub.id}/preview`).expect(404);
    await alice.get(`/quotes/${f.quote.id}`).expect(404);
    await alice.get(`/customers/${bob.customerId}`).expect(404);
    const rows = await alice
      .get(`/invoices?customerId=${bob.customerId}`)
      .expect(200);
    expect(rows.body.items).toHaveLength(0);
    await alice.post(`/quotes/${f.quote.id}/accept`, {}).expect(404);
  });
  it("prevents privilege escalation and financial mutations", async () => {
    await alice
      .post("/staff/invite", { email: "attacker@example.test", role: "ADMIN" })
      .expect(403);
    await alice.post("/payments", {}).expect(403);
    await alice.post("/adjustments", {}).expect(403);
    await alice.agent
      .patch(`/api/v1/customers/${alice.customerId}`)
      .set("Origin", config.WEB_ORIGIN)
      .send({ taxExempt: true, role: "ADMIN" })
      .expect(400);
  });
  it("rejects cross-site mutations and absent origins", async () => {
    await admin.agent
      .post("/api/v1/products")
      .set("Origin", "https://attacker.test")
      .send({ name: "evil", salesPrice: "1" })
      .expect(403);
    await admin.agent
      .post("/api/v1/products")
      .send({ name: "evil", salesPrice: "1" })
      .expect(403);
  });
  it("blocks admin data until privileged MFA enrollment", async () => {
    const unenrolled = await account("FINANCE", false);
    await unenrolled.get("/invoices").expect(403);
    const me = await unenrolled.get("/me").expect(200);
    expect(me.body.requiresMfa).toBe(true);
  });
  it("validates malicious inputs and prevents SQL injection", async () => {
    await admin
      .post("/products", { name: "bad", salesPrice: "NaN" })
      .expect(400);
    const rows = await alice
      .get(
        `/subscriptions?search=${encodeURIComponent("'; DROP TABLE User; --")}`,
      )
      .expect(200);
    expect(rows.body.items).toHaveLength(0);
    expect(await db.user.count()).toBeGreaterThan(0);
  });
  it("does not expose internal product cost to customers", async () => {
    const product = await admin
      .post("/products", {
        name: "Private internal cost",
        salesPrice: "1000",
        costPrice: "200",
      })
      .expect(201);
    const result = await alice.get(`/products/${product.body.id}`).expect(200);
    expect(result.body).not.toHaveProperty("costPrice");
  });
  it("rejects negative amounts, overpayments and duplicate references", async () => {
    const f = await fixture(admin, alice.customerId),
      invoice = await billOne(f.sub.id);
    await admin.post(`/invoices/${invoice.invoiceId}/confirm`, {}).expect(200);
    const reference = randomUUID();
    const p = {
      customerId: alice.customerId,
      reference,
      amount: "1001",
      currency: "INR",
      method: "CASH",
      receivedAt: new Date().toISOString(),
      allocations: [{ invoiceId: invoice.invoiceId, amount: "1001" }],
    };
    await admin.post("/payments", p).expect(400);
    await admin
      .post("/payments", { ...p, amount: "-1", allocations: [] })
      .expect(400);
    await admin
      .post("/payments", { ...p, amount: "1", allocations: [] })
      .expect(201);
    await admin
      .post("/payments", { ...p, amount: "1", allocations: [] })
      .expect(409);
  });
  it("blocks replayed discount consumption beyond the global usage limit", async () => {
    const discount = await admin
      .post("/discounts", {
        code: `TEST${randomUUID()}`,
        type: "PERCENT",
        value: "10",
        startsAt: new Date(Date.now() - 86400000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        usageLimit: 1,
      })
      .expect(201);
    const a = await fixture(admin, alice.customerId, {
        discountId: discount.body.id,
      }),
      b = await fixture(admin, bob.customerId, {
        discountId: discount.body.id,
      });
    const invoices = await Promise.all([billOne(a.sub.id), billOne(b.sub.id)]);
    expect(invoices.map((i) => i.total).sort()).toEqual(["1000", "900"]);
    expect(
      (await db.discount.findUniqueOrThrow({ where: { id: discount.body.id } }))
        .used,
    ).toBe(1);
  });
  it("uses HttpOnly SameSite cookies and security headers", async () => {
    const r = await request(app)
      .post("/api/auth/sign-in/email")
      .set("Origin", config.WEB_ORIGIN)
      .send({ email: alice.email, password: alice.password })
      .expect(200);
    const cookies = (r.headers["set-cookie"] as unknown as string[]).join(" ");
    expect(cookies).toMatch(/httponly/i);
    expect(cookies).toMatch(/samesite=lax/i);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
  it("normalizes registration, rejects weak passwords and ignores role fields", async () => {
    await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", config.WEB_ORIGIN)
      .send({
        name: "Weak User",
        email: `weak-${randomUUID()}@example.test`,
        password: "weak",
      })
      .expect(400);
    const email = `new-${randomUUID()}@EXAMPLE.TEST`;
    const r = await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", config.WEB_ORIGIN)
      .send({
        name: "New user",
        email,
        password: "LongPassphrase!Aa123",
        role: "ADMIN",
      })
      .expect(200);
    const user = await db.user.findUniqueOrThrow({
      where: { id: r.body.user.id },
    });
    expect(user.role).toBe("CUSTOMER");
    expect(user.email).toBe(email.toLowerCase());
    const credential = await db.account.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(credential.password).toMatch(/^\$argon2id\$/);
  });
  it("throttles repeated credential attempts without disclosing account existence", async () => {
    const email = `rate-${randomUUID()}@example.test`;
    let status = 0;
    for (let i = 0; i < 6; i++) {
      const r = await request(app)
        .post("/api/auth/sign-in/email")
        .set("Origin", config.WEB_ORIGIN)
        .send({ email, password: "Wrong!Aa123456789" });
      status = r.status;
    }
    expect(status).toBe(429);
    const limiter = await db.rateLimit.findUniqueOrThrow({
      where: { key: `credential:${digest(email)}` },
    });
    expect(limiter.count).toBe(6);
  });
});
