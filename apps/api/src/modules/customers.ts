import { Router } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { db, transaction, audit, number } from "../db.js";
import { allow, own } from "../access.js";
import { check } from "../errors.js";
import {
  customerInput,
  pageInput,
} from "../../../../packages/validation/src/index.js";
export const customers = Router();
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
customers.get("/customers", async (req, res) => {
  const q = pageInput.parse(req.query),
    where = {
      ...(req.actor.role === "CUSTOMER"
        ? { id: req.actor.customerId ?? "__none__" }
        : {}),
      OR: [
        { name: { contains: q.search, mode: "insensitive" as const } },
        { email: { contains: q.search, mode: "insensitive" as const } },
      ],
    };
  const [items, total] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.customer.count({ where }),
  ]);
  res.json({ items, total });
});
customers.get(
  "/customers/export",
  allow("ADMIN", "SALES", "FINANCE"),
  async (_req, res) => {
    const rows = await db.customer.findMany({
      take: 10000,
      orderBy: { id: "asc" },
    });
    res
      .type("csv")
      .attachment("customers.csv")
      .send(
        [
          "name,email,company,currency",
          ...rows.map((r) =>
            [r.name, r.email, r.company, r.currency].map(csvCell).join(","),
          ),
        ].join("\r\n"),
      );
  },
);
customers.post(
  "/customers/import",
  allow("ADMIN", "SALES"),
  async (req, res) => {
    const { csv } = z
      .object({ csv: z.string().max(500000) })
      .strict()
      .parse(req.body);
    const raw: unknown = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      max_record_size: 8000,
    });
    const rows = z.array(customerInput).max(1000).parse(raw);
    check(
      new Set(rows.map((r) => r.email)).size === rows.length,
      "Duplicate emails in import",
    );
    const result = await transaction(async (tx) => {
      const result = await tx.customer.createMany({
        data: rows.map((r) => ({ ...r, number: number("CUS") })),
      });
      await audit(tx, req.actor.id, "CUSTOMERS_IMPORTED", "customers", {
        count: result.count,
      });
      return result;
    });
    res.status(201).json(result);
  },
);
customers.post("/customers", allow("ADMIN", "SALES"), async (req, res) => {
  const input = customerInput.parse(req.body);
  res.status(201).json(
    await transaction(async (tx) => {
      const item = await tx.customer.create({
        data: { ...input, number: number("CUS") },
      });
      await audit(tx, req.actor.id, "CUSTOMER_CREATED", item.id);
      return item;
    }),
  );
});
customers.get("/customers/:id", async (req, res) => {
  const id = String(req.params.id);
  own(req.actor, id);
  const customer = await db.customer.findUnique({
    where: { id },
    include: { contacts: true },
  });
  check(customer, "Customer not found", 404);
  res.json(customer);
});
customers.patch(
  "/customers/:id",
  allow("ADMIN", "SALES", "CUSTOMER"),
  async (req, res) => {
    const id = String(req.params.id);
    own(req.actor, id);
    const schema =
      req.actor.role === "CUSTOMER"
        ? customerInput
            .pick({
              name: true,
              company: true,
              phone: true,
              billingAddress: true,
              serviceAddress: true,
            })
            .partial()
        : customerInput.omit({ email: true }).partial();
    const input = schema.parse(req.body);
    res.json(
      await transaction(async (tx) => {
        const item = await tx.customer.update({ where: { id }, data: input });
        await audit(tx, req.actor.id, "CUSTOMER_UPDATED", id, input);
        return item;
      }),
    );
  },
);
customers.post(
  "/customers/:id/contacts",
  allow("ADMIN", "SALES"),
  async (req, res) => {
    const input = z
      .object({
        name: z.string().min(2).max(100),
        email: z.email(),
        phone: z.string().max(40).default(""),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await db.contact.create({
          data: { ...input, customerId: String(req.params.id) },
        }),
      );
  },
);
customers.post(
  "/customers/:id/notes",
  allow("ADMIN", "SALES", "SUPPORT"),
  async (req, res) => {
    const input = z
      .object({ note: z.string().min(1).max(2000) })
      .strict()
      .parse(req.body);
    const id = String(req.params.id);
    check(
      await db.customer.findUnique({ where: { id } }),
      "Customer not found",
      404,
    );
    res
      .status(201)
      .json(await audit(db, req.actor.id, "SUPPORT_NOTE", id, input));
  },
);
