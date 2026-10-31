import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import {
  customerInput,
  productInput,
  variantInput,
  planInput,
  quoteInput,
  taxInput,
  discountInput,
  paymentInput,
  invitationInput,
} from "../packages/validation/src/index.js";
const schemas = {
  Customer: customerInput,
  Product: productInput,
  Variant: variantInput,
  Plan: planInput,
  Quote: quoteInput,
  Tax: taxInput,
  Discount: discountInput,
  Payment: paymentInput,
  Invitation: invitationInput,
};
const paths: Record<string, Record<string, unknown>> = {};
for (const file of await readdir("apps/api/src/modules")) {
  if (!file.endsWith(".ts")) continue;
  const source = await readFile(`apps/api/src/modules/${file}`, "utf8");
  for (const match of source.matchAll(
    /\w+\.(get|post|patch|put)\('([^']+)'/g,
  )) {
    const method = match[1]!,
      route = match[2]!,
      parameters = [...route.matchAll(/:(\w+)/g)].map((m) => ({
        name: m[1],
        in: "path",
        required: true,
        schema: { type: "string" },
      }));
    const path = `/api/v1${route.replace(/:(\w+)/g, "{$1}")}`;
    const schemaName =
      route === "/products"
        ? "Product"
        : route === "/plans"
          ? "Plan"
          : route === "/quotes"
            ? "Quote"
            : route === "/customers"
              ? "Customer"
              : route === "/payments"
                ? "Payment"
                : route === "/taxes"
                  ? "Tax"
                  : route === "/discounts"
                    ? "Discount"
                    : route === "/staff/invite"
                      ? "Invitation"
                      : undefined;
    paths[path] ??= {};
    paths[path]![method] = {
      tags: [file.replace(".ts", "")],
      operationId: `${method}_${route.replaceAll(/[^a-z0-9]/gi, "_")}`,
      summary: `${method.toUpperCase()} ${route}`,
      security: [{ session: [] }],
      parameters: [
        ...parameters,
        ...(method === "get" && !parameters.length
          ? [
              {
                name: "page",
                in: "query",
                schema: { type: "integer", minimum: 1, default: 1 },
              },
              {
                name: "limit",
                in: "query",
                schema: {
                  type: "integer",
                  minimum: 1,
                  maximum: 100,
                  default: 25,
                },
              },
              { name: "search", in: "query", schema: { type: "string" } },
            ]
          : []),
        ...(method !== "get"
          ? [
              {
                name: "Origin",
                in: "header",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "Idempotency-Key",
                in: "header",
                required:
                  ["/payments", "/adjustments"].includes(route) ||
                  route.endsWith("/decide") ||
                  route.endsWith("/allocate"),
                schema: { type: "string", minLength: 8, maxLength: 120 },
              },
            ]
          : []),
      ],
      ...(method !== "get"
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: schemaName
                    ? { $ref: `#/components/schemas/${schemaName}` }
                    : {
                        type: "object",
                        description:
                          "See docs/api/README.md and the named module for action-specific validation.",
                      },
                },
              },
            },
          }
        : {}),
      responses: {
        "200": { description: "Success" },
        "201": { description: "Created" },
        "202": { description: "Queued" },
        "400": { description: "Invalid input or business transition" },
        "401": { description: "Sign-in required" },
        "403": { description: "Role, MFA or origin rejected" },
        "404": { description: "Record not found or outside customer scope" },
        "409": { description: "Idempotency or financial conflict" },
      },
    };
  }
}
const document = {
  openapi: "3.1.0",
  info: {
    title: "Brightloop SubscriptionOS",
    version: "0.1.0",
    description:
      "Business REST API. Cookie authentication is supplied by Better Auth at /api/auth. Financial totals are decimal strings. Authentication and ownership checks apply independently to every endpoint.",
  },
  servers: [{ url: "http://localhost:5173" }],
  paths,
  components: {
    securitySchemes: {
      session: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
      },
    },
    schemas: Object.fromEntries(
      Object.entries(schemas).map(([k, s]) => [
        k,
        z.toJSONSchema(s, { io: "input" }),
      ]),
    ),
  },
};
await mkdir("docs/api", { recursive: true });
await writeFile("docs/api/openapi.json", JSON.stringify(document, null, 2));
console.log(`Documented ${Object.keys(paths).length} business paths`);
