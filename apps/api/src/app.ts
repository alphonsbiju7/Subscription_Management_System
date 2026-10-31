import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { db, logger } from "./db.js";
import { auth } from "./auth.js";
import { authenticate } from "./access.js";
import { ApiError } from "./errors.js";
import { catalog } from "./modules/catalog.js";
import { customers } from "./modules/customers.js";
import { sales } from "./modules/sales.js";
import { billing } from "./modules/billing.js";
import { finance } from "./modules/finance.js";
import { reports } from "./modules/reports.js";
import { integrity } from "./modules/integrity.js";
import { usage } from "./modules/usage.js";
import { admin } from "./modules/admin.js";
import { documents } from "./modules/documents.js";
export function safeRequestPath(path: string) {
  return path.replace(
    /^\/api\/auth\/reset-password\/[^/]+$/,
    "/api/auth/reset-password/:token",
  );
}
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    const start = performance.now();
    const requestPath = safeRequestPath(req.path);
    res.on("finish", () =>
      logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          path: requestPath,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        "request",
      ),
    );
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
        },
      },
      hsts: config.NODE_ENV === "production",
    }),
  );
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
      allowedHeaders: ["Content-Type", "Idempotency-Key"],
    }),
  );
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: config.NODE_ENV === "test" ? 10000 : 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (req, _res, next) => {
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(req.method) &&
      req.get("Origin") !== config.WEB_ORIGIN
    )
      return next(new ApiError(403, "Request origin rejected"));
    if (Number(req.get("Content-Length") ?? 0) > 1024 * 1024)
      return next(new ApiError(413, "Request too large"));
    next();
  });
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json({ limit: "1mb", strict: true }));
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });
  app.get("/api/openapi.json", (_req, res) =>
    res
      .type("json")
      .send(readFileSync(resolve("docs/api/openapi.json"), "utf8")),
  );
  app.use(
    "/api/v1",
    authenticate,
    admin,
    customers,
    catalog,
    sales,
    billing,
    finance,
    usage,
    reports,
    integrity,
    documents,
  );
  app.use("/api", (_req, _res, next) =>
    next(new ApiError(404, "Endpoint not found")),
  );
  if (config.NODE_ENV === "production") {
    app.use(express.static(resolve("apps/web/dist")));
    app.get("/{*splat}", (_req, res) =>
      res.sendFile(resolve("apps/web/dist/index.html")),
    );
  }
  const errors: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Validation failed",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
        requestId: req.requestId,
      });
      return;
    }
    if (error instanceof ApiError) {
      res
        .status(error.status)
        .json({ error: error.message, requestId: req.requestId });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const status = error.code === "P2025" ? 404 : 409;
      res.status(status).json({
        error:
          status === 404
            ? "Record not found"
            : "The operation conflicts with an existing record or financial constraint",
        requestId: req.requestId,
      });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    logger.error(
      {
        error: error instanceof Error ? error.message : "Unknown",
        requestId: req.requestId,
      },
      "request failed",
    );
    res.status(500).json({
      error: "Operation failed. Contact support with this request ID.",
      requestId: req.requestId,
    });
  };
  app.use(errors);
  return app;
}
