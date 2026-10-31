import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { db } from "./db.js";
import { ApiError, check } from "./errors.js";
import type { Actor, Role } from "../../../packages/shared-types/src/index.js";
declare module "express-serve-static-core" {
  interface Request {
    actor: Actor;
    requestId: string;
  }
}
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    check(session, "Please sign in", 401);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      include: { customer: true },
    });
    check(user && !user.suspended, "Account unavailable", 403);
    req.actor = {
      id: user.id,
      role: user.role,
      customerId: user.customer?.id ?? null,
      requestId: req.requestId,
    };
    if (!req.path.startsWith("/me") && ["ADMIN", "FINANCE"].includes(user.role))
      check(
        user.twoFactorEnabled,
        "Set up MFA in Account security before accessing the workspace",
        403,
      );
    next();
  } catch (e) {
    next(e);
  }
}
export function allow(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) =>
    roles.includes(req.actor.role)
      ? next()
      : next(
          new ApiError(403, "You do not have permission for this operation"),
        );
}
export function own(actor: Actor, customerId: string) {
  check(
    actor.role !== "CUSTOMER" || actor.customerId === customerId,
    "Record not found",
    404,
  );
}
export function customerScope(actor: Actor) {
  return actor.role === "CUSTOMER"
    ? { customerId: actor.customerId ?? "__no_customer__" }
    : {};
}
