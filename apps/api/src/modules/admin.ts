import { Router } from "express";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import { db, transaction, lock, audit, outbox } from "../db.js";
import { allow } from "../access.js";
import { auth } from "../auth.js";
import { check } from "../errors.js";
import {
  invitationInput,
  pageInput,
} from "../../../../packages/validation/src/index.js";
import { config } from "../config.js";
import { encrypt } from "../crypto.js";
export const admin = Router();
const hashToken = (v: string) => createHash("sha256").update(v).digest("hex");
admin.get("/me", async (req, res) => {
  let user = await db.user.findUnique({
    where: { id: req.actor.id },
    include: { customer: true },
  });
  check(user, "Account not found", 404);
  if (!user.customer && user.emailVerified && user.role === "CUSTOMER") {
    await db.customer.updateMany({
      where: { email: user.email, userId: null },
      data: { userId: user.id },
    });
    user = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { customer: true },
    });
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    requiresMfa:
      ["ADMIN", "FINANCE"].includes(user.role) && !user.twoFactorEnabled,
    customerId: user.customer?.id ?? null,
    customer: user.customer,
  });
});
admin.post("/me/accept-invite", async (req, res) => {
  const { token } = z
    .object({ token: z.string().min(32).max(200) })
    .strict()
    .parse(req.body);
  res.json(
    await transaction(async (tx) => {
      await lock(tx, `invite:${hashToken(token)}`);
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: req.actor.id },
      });
      check(
        invitation &&
          !invitation.usedAt &&
          invitation.expiresAt > new Date() &&
          invitation.email === user.email &&
          user.emailVerified,
        "Invitation unavailable or email is not verified",
      );
      check(user.role === "CUSTOMER", "Account already has staff access");
      await tx.user.update({
        where: { id: user.id },
        data: { role: invitation.role },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await audit(tx, user.id, "INVITATION_ACCEPTED", invitation.id, {
        role: invitation.role,
      });
      return { accepted: true, signInAgain: true };
    }),
  );
});
admin.get("/staff", allow("ADMIN"), async (req, res) => {
  const q = pageInput.parse(req.query);
  res.json({
    items: await db.user.findMany({
      where: {
        role: { not: "CUSTOMER" },
        OR: [
          { name: { contains: q.search, mode: "insensitive" } },
          { email: { contains: q.search, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        suspended: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
      take: q.limit,
      skip: (q.page - 1) * q.limit,
    }),
    invitations: await db.invitation.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        usedAt: true,
      },
      take: 100,
    }),
  });
});
admin.post("/staff/invite", allow("ADMIN"), async (req, res) => {
  const input = invitationInput.parse(req.body);
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  check(
    session &&
      Date.now() - session.session.createdAt.getTime() < 15 * 60 * 1000,
    "Sign in again before inviting staff",
    403,
  );
  res.status(201).json(
    await transaction(async (tx) => {
      const token = randomBytes(32).toString("base64url");
      const invitation = await tx.invitation.create({
        data: {
          ...input,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      await outbox(
        tx,
        `invite:${invitation.id}`,
        input.email,
        "Join the Brightloop team",
        {
          encrypted: encrypt(
            `Register and verify ${input.email}, then accept your invitation: ${config.WEB_ORIGIN}/invite#${token}`,
          ),
        },
      );
      await audit(tx, req.actor.id, "STAFF_INVITED", invitation.id, input);
      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      };
    }),
  );
});
admin.patch("/staff/:id", allow("ADMIN"), async (req, res) => {
  const input = z
    .object({
      suspended: z.boolean().optional(),
      role: z
        .enum(["ADMIN", "SALES", "FINANCE", "SUPPORT", "CUSTOMER"])
        .optional(),
    })
    .strict()
    .parse(req.body);
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  check(
    session && Date.now() - session.session.createdAt.getTime() < 900000,
    "Sign in again before changing staff access",
    403,
  );
  res.json(
    await transaction(async (tx) => {
      const id = String(req.params.id);
      check(id !== req.actor.id, "You cannot change your own staff access");
      const current = await tx.user.findUnique({ where: { id } });
      check(current, "User not found", 404);
      const user = await tx.user.update({ where: { id }, data: input });
      await tx.session.deleteMany({ where: { userId: id } });
      await audit(tx, req.actor.id, "STAFF_ACCESS_CHANGED", id, {
        before: { role: current.role, suspended: current.suspended },
        after: input,
      });
      return { id: user.id, role: user.role, suspended: user.suspended };
    }),
  );
});
const settingSchema = z
  .object({
    graceDays: z.number().int().min(1).max(90),
    reminderDays: z.array(z.number().int().min(1).max(90)).min(1).max(10),
    renewalNoticeDays: z.number().int().min(1).max(90),
    companyName: z.string().min(2).max(160),
    supportEmail: z.email(),
  })
  .strict();
admin.get("/settings", allow("ADMIN"), async (_req, res) =>
  res.json({
    items: await db.setting.findMany(),
    integrations: {
      payments:
        "Manual receipts and DEMO MODE simulated checkout enabled. No external payment gateway.",
      mail:
        config.NODE_ENV === "production"
          ? "SMTP"
          : "Local file sink (.local/mail)",
      timezone: config.BUSINESS_TIMEZONE,
    },
  }),
);
admin.put("/settings", allow("ADMIN"), async (req, res) => {
  const input = settingSchema.parse(req.body);
  res.json(
    await transaction(async (tx) => {
      const item = await tx.setting.upsert({
        where: { key: "business" },
        create: { key: "business", value: input },
        update: { value: input },
      });
      await audit(tx, req.actor.id, "SETTINGS_UPDATED", "business", input);
      return item;
    }),
  );
});
admin.post("/notifications/:id/retry", allow("ADMIN"), async (req, res) =>
  res.json(
    await transaction(async (tx) => {
      const item = await tx.outbox.findUnique({
        where: { id: String(req.params.id) },
      });
      check(
        item?.status === "DEAD",
        "Only dead-letter deliveries can be retried",
      );
      const result = await tx.outbox.update({
        where: { id: item.id },
        data: { status: "PENDING", attempts: 0, availableAt: new Date() },
      });
      await audit(tx, req.actor.id, "NOTIFICATION_RETRIED", item.id);
      return { id: result.id, status: result.status };
    }),
  ),
);
