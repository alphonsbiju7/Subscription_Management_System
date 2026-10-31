import { Router } from "express";
import { z } from "zod";
import { db, audit, transaction, json, lock } from "../db.js";
import { allow } from "../access.js";
import { check } from "../errors.js";
import {
  productInput,
  variantInput,
  planInput,
  taxInput,
  discountInput,
  pageInput,
  money,
} from "../../../../packages/validation/src/index.js";
export const catalog = Router();
function productView<T extends { costPrice: unknown }>(item: T, role: string) {
  if (["ADMIN", "FINANCE"].includes(role)) return item;
  const { costPrice: _costPrice, ...publicFields } = item;
  return publicFields;
}
catalog.get("/products/:id", async (req, res) => {
  const item = await db.product.findUnique({
    where: { id: String(req.params.id) },
    include: {
      variants: true,
      addons: true,
      plans: { include: { versions: { orderBy: { version: "desc" } } } },
    },
  });
  check(
    item && (req.actor.role !== "CUSTOMER" || item.active),
    "Product not found",
    404,
  );
  res.json(productView(item, req.actor.role));
});
catalog.get("/plans/:id", async (req, res) => {
  const item = await db.plan.findUnique({
    where: { id: String(req.params.id) },
    include: {
      product: true,
      versions: { orderBy: { version: "desc" }, include: { tax: true } },
    },
  });
  check(
    item && (req.actor.role !== "CUSTOMER" || item.active),
    "Plan not found",
    404,
  );
  res.json({ ...item, product: productView(item.product, req.actor.role) });
});
catalog.get("/products", async (req, res) => {
  const q = pageInput.parse(req.query),
    where = {
      name: { contains: q.search, mode: "insensitive" as const },
      ...(req.actor.role === "CUSTOMER" ? { active: true } : {}),
    };
  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { name: "asc" },
      include: {
        variants: true,
        addons: true,
        plans: {
          where: { active: true },
          include: {
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              include: { tax: true },
            },
          },
        },
      },
    }),
    db.product.count({ where }),
  ]);
  res.json({
    items: items.map((p) => productView(p, req.actor.role)),
    total,
    page: q.page,
  });
});
catalog.post("/products", allow("ADMIN"), async (req, res) => {
  const input = productInput.parse(req.body);
  const item = await transaction(async (tx) => {
    const item = await tx.product.create({ data: input });
    await audit(
      tx,
      req.actor.id,
      "PRODUCT_CREATED",
      item.id,
      input,
      req.requestId,
    );
    return item;
  });
  res.status(201).json(item);
});
catalog.patch("/products/:id", allow("ADMIN"), async (req, res) => {
  const input = productInput.partial().parse(req.body);
  res.json(
    await transaction(async (tx) => {
      const item = await tx.product.update({
        where: { id: String(req.params.id) },
        data: input,
      });
      await audit(
        tx,
        req.actor.id,
        "PRODUCT_UPDATED",
        item.id,
        input,
        req.requestId,
      );
      return item;
    }),
  );
});
catalog.post("/products/:id/variants", allow("ADMIN"), async (req, res) => {
  const input = variantInput.parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const variant = await tx.variant.create({
        data: { ...input, productId: String(req.params.id) },
      });
      await audit(tx, req.actor.id, "VARIANT_CREATED", variant.id, input);
      return variant;
    }),
  );
});
catalog.patch("/variants/:id", allow("ADMIN"), async (req, res) => {
  const input = variantInput.partial().parse(req.body);
  res.json(
    await transaction(async (tx) => {
      const variant = await tx.variant.update({
        where: { id: String(req.params.id) },
        data: input,
      });
      await audit(tx, req.actor.id, "VARIANT_UPDATED", variant.id, input);
      return variant;
    }),
  );
});
catalog.post("/products/:id/addons", allow("ADMIN"), async (req, res) => {
  const input = z
    .object({ name: z.string().min(2).max(100), price: money })
    .strict()
    .parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const addon = await tx.addon.create({
        data: { ...input, productId: String(req.params.id) },
      });
      await audit(tx, req.actor.id, "ADDON_CREATED", addon.id, input);
      return addon;
    }),
  );
});
catalog.get("/plans", async (req, res) => {
  const q = pageInput.parse(req.query),
    where = {
      name: { contains: q.search, mode: "insensitive" as const },
      ...(q.productId ? { productId: q.productId } : {}),
      ...(req.actor.role === "CUSTOMER" ? { active: true } : {}),
    };
  const [items, total] = await Promise.all([
    db.plan.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: "desc" },
      include: {
        product: true,
        versions: { orderBy: { version: "desc" }, include: { tax: true } },
      },
    }),
    db.plan.count({ where }),
  ]);
  res.json({
    items: items.map((p) => ({
      ...p,
      product: productView(p.product, req.actor.role),
    })),
    total,
  });
});
catalog.post("/plans", allow("ADMIN"), async (req, res) => {
  const input = planInput.parse(req.body),
    { productId, name, description, ...version } = input;
  const product = await db.product.findUnique({ where: { id: productId } });
  check(product?.active, "Active product required");
  check(
    product.currency === input.currency,
    "Product and plan currencies must match",
  );
  res.status(201).json(
    await transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          name,
          description,
          productId,
          versions: {
            create: {
              ...version,
              tiers: json(version.tiers),
              entitlements: json(version.entitlements),
            },
          },
        },
        include: { versions: true },
      });
      await audit(tx, req.actor.id, "PLAN_CREATED", plan.id, input);
      return plan;
    }),
  );
});
catalog.post("/plans/:id/versions", allow("ADMIN"), async (req, res) => {
  const input = planInput.parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      await lock(tx, `plan:${req.params.id}`);
      const plan = await tx.plan.findUnique({
        where: { id: String(req.params.id) },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
      check(plan, "Plan not found", 404);
      check(plan.productId === input.productId, "Product cannot change");
      const {
        name: _name,
        description: _description,
        productId: _productId,
        ...version
      } = input;
      const item = await tx.planVersion.create({
        data: {
          ...version,
          tiers: json(version.tiers),
          entitlements: json(version.entitlements),
          planId: plan.id,
          version: (plan.versions[0]?.version ?? 0) + 1,
        },
      });
      await audit(tx, req.actor.id, "PLAN_VERSION_CREATED", plan.id, item);
      return item;
    }),
  );
});
catalog.patch("/plans/:id", allow("ADMIN"), async (req, res) => {
  const input = z.object({ active: z.boolean() }).strict().parse(req.body);
  res.json(
    await transaction(async (tx) => {
      const item = await tx.plan.update({
        where: { id: String(req.params.id) },
        data: input,
      });
      await audit(tx, req.actor.id, "PLAN_STATUS_CHANGED", item.id, input);
      return item;
    }),
  );
});
catalog.get("/taxes", allow("ADMIN", "SALES", "FINANCE"), async (req, res) => {
  const q = pageInput.parse(req.query),
    where = { name: { contains: q.search, mode: "insensitive" as const } };
  res.json({
    items: await db.tax.findMany({
      where,
      take: q.limit,
      skip: (q.page - 1) * q.limit,
      orderBy: { name: "asc" },
    }),
    total: await db.tax.count({ where }),
  });
});
catalog.post("/taxes", allow("ADMIN"), async (req, res) => {
  const input = taxInput.parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const item = await tx.tax.create({ data: input });
      await audit(tx, req.actor.id, "TAX_CREATED", item.id, input);
      return item;
    }),
  );
});
catalog.get(
  "/discounts",
  allow("ADMIN", "SALES", "FINANCE"),
  async (req, res) => {
    const q = pageInput.parse(req.query),
      where = { code: { contains: q.search, mode: "insensitive" as const } };
    res.json({
      items: await db.discount.findMany({
        where,
        take: q.limit,
        skip: (q.page - 1) * q.limit,
        orderBy: { startsAt: "desc" },
      }),
      total: await db.discount.count({ where }),
    });
  },
);
catalog.post("/discounts", allow("ADMIN"), async (req, res) => {
  const input = discountInput.parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const item = await tx.discount.create({ data: input });
      await audit(tx, req.actor.id, "DISCOUNT_CREATED", item.id, input);
      return item;
    }),
  );
});
catalog.patch("/discounts/:id", allow("ADMIN"), async (req, res) => {
  const input = z.object({ active: z.boolean() }).strict().parse(req.body);
  res.json(
    await transaction(async (tx) => {
      const item = await tx.discount.update({
        where: { id: String(req.params.id) },
        data: input,
      });
      await audit(tx, req.actor.id, "DISCOUNT_STATUS_CHANGED", item.id, input);
      return item;
    }),
  );
});
