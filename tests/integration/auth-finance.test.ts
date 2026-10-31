import { describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import request from "supertest";
import { account, app, fixture } from "../support.js";
import { db } from "../../apps/api/src/db.js";
import { decrypt } from "../../apps/api/src/crypto.js";
import { config } from "../../apps/api/src/config.js";
import { billOne } from "../../apps/api/src/modules/billing.js";
describe("account recovery and staff access", () => {
  it("normalizes, hashes and consumes an authorized staff invitation, then revokes suspended sessions", async () => {
    const admin = await account("ADMIN"),
      user = await account("CUSTOMER");
    const invite = await admin
      .post("/staff/invite", { email: user.email, role: "SUPPORT" })
      .expect(201);
    const message = await db.outbox.findUniqueOrThrow({
      where: { key: `invite:${invite.body.id}` },
    });
    const body = decrypt((message.payload as { encrypted: string }).encrypted);
    const token = body.split("#").at(-1)!;
    const row = await db.invitation.findUniqueOrThrow({
      where: { id: invite.body.id },
    });
    expect(row.tokenHash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    await user.post("/me/accept-invite", { token }).expect(200);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).role,
    ).toBe("SUPPORT");
    await user.get("/me").expect(401);
    await user.agent
      .post("/api/auth/sign-in/email")
      .set("Origin", config.WEB_ORIGIN)
      .send({ email: user.email, password: user.password })
      .expect(200);
    await user.post("/me/accept-invite", { token }).expect(400);
    await admin.agent
      .patch(`/api/v1/staff/${user.id}`)
      .set("Origin", config.WEB_ORIGIN)
      .send({ suspended: true })
      .expect(200);
    await user.get("/me").expect(401);
  });
  it("resets with a hashed single-use token and revokes existing sessions", async () => {
    const user = await account("CUSTOMER");
    await user.agent
      .post("/api/auth/request-password-reset")
      .set("Origin", config.WEB_ORIGIN)
      .send({ email: user.email, redirectTo: `${config.WEB_ORIGIN}/reset` })
      .expect(200);
    const message = await db.outbox.findFirstOrThrow({
      where: {
        recipient: user.email,
        subject: "Reset your Brightloop password",
      },
      orderBy: { createdAt: "desc" },
    });
    const body = decrypt((message.payload as { encrypted: string }).encrypted),
      url = body.match(/https?:\/\/\S+/)![0]!,
      token = new URL(url).pathname.split("/").at(-1)!;
    const stored = await db.verification.findFirst({
      where: { identifier: { contains: token } },
    });
    expect(stored).toBeNull();
    const password = `Reset!Aa${randomUUID()}`;
    await request(app)
      .post("/api/auth/reset-password")
      .set("Origin", config.WEB_ORIGIN)
      .send({ token, newPassword: password })
      .expect(200);
    await user.get("/me").expect(401);
    await request(app)
      .post("/api/auth/reset-password")
      .set("Origin", config.WEB_ORIGIN)
      .send({ token, newPassword: password })
      .expect(400);
  });
});
describe("financial boundary cases", () => {
  it("approves an unapplied-payment refund only once and refuses double spending", async () => {
    const admin = await account("ADMIN"),
      finance = await account("FINANCE"),
      user = await account("CUSTOMER");
    const receipt = await finance
      .post("/payments", {
        customerId: user.customerId,
        reference: randomUUID(),
        amount: "500",
        currency: "INR",
        method: "BANK_TRANSFER",
        receivedAt: new Date().toISOString(),
      })
      .expect(201);
    const a = await finance
      .post("/adjustments", {
        customerId: user.customerId,
        paymentId: receipt.body.id,
        kind: "REFUND",
        amount: "500",
        currency: "INR",
        reason: "Return unapplied customer receipt",
      })
      .expect(201);
    await finance
      .post(`/adjustments/${a.body.id}/decide`, { approve: true })
      .expect(403);
    await admin
      .post(`/adjustments/${a.body.id}/decide`, { approve: true })
      .expect(200);
    await admin
      .post(`/adjustments/${a.body.id}/decide`, { approve: true })
      .expect(400);
    const b = await finance
      .post("/adjustments", {
        customerId: user.customerId,
        paymentId: receipt.body.id,
        kind: "REFUND",
        amount: "1",
        currency: "INR",
        reason: "Attempt duplicate refund beyond available funds",
      })
      .expect(201);
    await admin
      .post(`/adjustments/${b.body.id}/decide`, { approve: true })
      .expect(400);
  });
  it("posts next-period amendments while preserving earlier invoice terms", async () => {
    const admin = await account("ADMIN"),
      user = await account("CUSTOMER"),
      f = await fixture(admin, user.customerId);
    const first = await billOne(f.sub.id);
    const version = await admin
      .post(`/plans/${f.plan.id}/versions`, {
        productId: f.product.id,
        name: "New edition",
        price: "2000",
        interval: "MONTHLY",
      })
      .expect(201);
    await user
      .post(`/subscriptions/${f.sub.id}/change`, {
        planVersionId: version.body.id,
        quantity: 2,
      })
      .expect(201);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: f.sub.id },
    });
    const next = await billOne(
      f.sub.id,
      new Date(sub.nextBillingAt.getTime() + 1000),
    );
    expect(next.total).toBe("4000");
    expect(
      (
        await db.invoice.findUniqueOrThrow({ where: { id: first.invoiceId } })
      ).total.toString(),
    ).toBe("1000");
    expect(
      await db.subscriptionEvent.count({
        where: { subscriptionId: f.sub.id, action: "PLAN_CHANGED" },
      }),
    ).toBe(1);
  });
  it("rejects fractional cents on cash operations", async () => {
    const finance = await account("FINANCE");
    await finance
      .post("/payments", {
        customerId: finance.customerId,
        reference: randomUUID(),
        amount: "0.005",
        currency: "INR",
        method: "CASH",
        receivedAt: new Date().toISOString(),
      })
      .expect(400);
  });
});
