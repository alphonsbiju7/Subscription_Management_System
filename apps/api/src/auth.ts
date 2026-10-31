import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import argon2 from "argon2";
import { db, audit, outbox, digest } from "./db.js";
import { config } from "./config.js";
import { password } from "../../../packages/validation/src/index.js";
import { encrypt } from "./crypto.js";

export const auth = betterAuth({
  appName: "Brightloop SubscriptionOS",
  baseURL: config.BETTER_AUTH_URL,
  basePath: "/api/auth",
  secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: [config.WEB_ORIGIN],
  database: prismaAdapter(db, { provider: "postgresql" }),
  verification: { storeIdentifier: "hashed" },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: config.NODE_ENV === "production" ? 14 : 9,
    maxPasswordLength: 256,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 900,
    password: {
      hash: (value) =>
        argon2.hash(value, {
          type: argon2.argon2id,
          memoryCost: 65536,
          timeCost: 3,
          parallelism: 1,
        }),
      verify: ({ hash, password }) => argon2.verify(hash, password),
    },
    sendResetPassword: async ({ user, url }) => {
      await outbox(
        db,
        `reset:${digest(url)}`,
        user.email,
        "Reset your Brightloop password",
        {
          encrypted: encrypt(
            `Reset your password (expires in 15 minutes): ${url}`,
          ),
        },
      );
    },
    onPasswordReset: async ({ user }) => {
      await audit(db, user.id, "PASSWORD_RESET", user.id);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }) => {
      await outbox(
        db,
        `verify:${digest(url)}`,
        user.email,
        "Verify your Brightloop email",
        { encrypted: encrypt(`Verify your email: ${url}`) },
      );
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "CUSTOMER", input: false },
      suspended: { type: "boolean", defaultValue: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 15,
    freshAge: 60 * 15,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 30 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 300, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: config.NODE_ENV === "production",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
  },
  plugins: [
    twoFactor({
      issuer: "Brightloop",
      backupCodeOptions: { storeBackupCodes: "encrypted" },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = ctx.body as Record<string, unknown> | undefined;
      if (body && typeof body.email === "string")
        body.email = body.email.trim().toLowerCase();
      if (
        [
          "/sign-up/email",
          "/reset-password",
          "/change-password",
          "/set-password",
        ].includes(ctx.path)
      ) {
        const parsed = password.safeParse(body?.newPassword ?? body?.password);
        if (!parsed.success)
          throw new APIError("BAD_REQUEST", {
            message:
              "Use 9–256 characters with uppercase, lowercase and a special character; avoid common passwords.",
          });
      }
      if (ctx.path === "/sign-in/email" && typeof body?.email === "string") {
        const key = `credential:${digest(body.email)}`,
          now = BigInt(Date.now());
        const rows = await db.$queryRaw<
          { count: number }[]
        >`INSERT INTO "RateLimit" (id,key,count,"lastRequest") VALUES (${key},${key},1,${now}) ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "RateLimit"."lastRequest"<${now - 60000n} THEN 1 ELSE "RateLimit".count+1 END,"lastRequest"=CASE WHEN "RateLimit"."lastRequest"<${now - 60000n} THEN ${now} ELSE "RateLimit"."lastRequest" END RETURNING count`;
        if ((rows[0]?.count ?? 0) > 5)
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many sign-in attempts. Try again later.",
          });
        const user = await db.user.findUnique({ where: { email: body.email } });
        if (user?.suspended)
          throw new APIError("UNAUTHORIZED", {
            message: "Invalid email or password",
          });
      }
      if (ctx.path === "/two-factor/disable")
        throw new APIError("FORBIDDEN", {
          message:
            "MFA cannot be disabled through self-service. Contact an administrator for reviewed account recovery.",
        });
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (
        ["/sign-in/email", "/sign-out", "/two-factor/verify-totp"].includes(
          ctx.path,
        )
      )
        await audit(
          db,
          ctx.context.session?.user.id ?? "anonymous",
          `AUTH${ctx.path.toUpperCase()}`,
          "authentication",
          {
            outcome:
              ctx.context.returned instanceof APIError ? "FAILED" : "PROCESSED",
          },
        );
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const existing = await db.customer.findUnique({
            where: { email: user.email },
          });
          // Linking an imported customer requires verified ownership, handled after email verification.
          if (!existing)
            await db.customer.create({
              data: { userId: user.id, name: user.name, email: user.email },
            });
        },
      },
    },
  },
});
