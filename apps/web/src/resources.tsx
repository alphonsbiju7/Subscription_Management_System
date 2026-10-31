import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  Search,
  Download,
  ArrowUpRight,
  Play,
  RefreshCw,
  FileCheck2,
  ArrowLeft,
  Pause,
  XCircle,
  Check,
  ShieldCheck,
  CircleDollarSign,
} from "lucide-react";
import {
  api,
  fmtDate,
  fmtMoney,
  text,
  value,
  type PageData,
  type RecordData,
  type User,
} from "./api";
import {
  Badge,
  ErrorBox,
  Form,
  Loading,
  Modal,
  Pagination,
  Table,
  type Column,
  type Field,
} from "./components";
import { AttemptHistory } from "./payments";
type Resource = {
  title: string;
  subtitle: string;
  endpoint: string;
  columns: Column[];
  create?: string;
  roles?: string[];
};
const dateCol = (key: string, label: string): Column => ({
  key,
  label,
  render: (r) => fmtDate(value(r, key)),
});
const amountCol = (key: string, label: string): Column => ({
  key,
  label,
  render: (r) => (
    <span className="amount">
      {fmtMoney(value(r, key), String(r.currency ?? "INR"))}
    </span>
  ),
});
const statusCol: Column = {
  key: "status",
  label: "Status",
  render: (r) => (
    <Badge>
      {r.displayStatus ??
        r.status ??
        (r.active === false ? "ARCHIVED" : "ACTIVE")}
    </Badge>
  ),
};
export const resources: Record<string, Resource> = {
  customers: {
    title: "Customers",
    subtitle: "The people and businesses behind your recurring revenue.",
    endpoint: "/customers",
    create: "Add customer",
    roles: ["ADMIN", "SALES"],
    columns: [
      { key: "name", label: "Customer" },
      { key: "email", label: "Email" },
      { key: "company", label: "Company" },
      { key: "currency", label: "Currency" },
      statusCol,
    ],
  },
  products: {
    title: "Product catalog",
    subtitle:
      "Build your offering with products, editions and optional add-ons.",
    endpoint: "/products",
    create: "Create product",
    roles: ["ADMIN"],
    columns: [
      { key: "name", label: "Product" },
      { key: "category", label: "Category" },
      amountCol("salesPrice", "List price"),
      {
        key: "variants",
        label: "Variants",
        render: (r) => String((r.variants as unknown[])?.length ?? 0),
      },
      statusCol,
    ],
  },
  plans: {
    title: "Plans & pricing",
    subtitle:
      "Clear pricing. Flexible intervals. Preserved agreement versions.",
    endpoint: "/plans",
    create: "Create plan",
    roles: ["ADMIN"],
    columns: [
      { key: "name", label: "Plan" },
      { key: "product.name", label: "Product" },
      {
        key: "interval",
        label: "Frequency",
        render: (r) => (
          <Badge>{value((r.versions as unknown[])?.[0], "interval")}</Badge>
        ),
      },
      {
        key: "price",
        label: "Price",
        render: (r) =>
          fmtMoney(
            value((r.versions as unknown[])?.[0], "price"),
            text(value((r.versions as unknown[])?.[0], "currency")),
          ),
      },
      statusCol,
    ],
  },
  quotes: {
    title: "Quotations",
    subtitle: "Turn a conversation into an agreed subscription.",
    endpoint: "/quotes",
    create: "Create quotation",
    roles: ["ADMIN", "SALES"],
    columns: [
      { key: "number", label: "Quotation" },
      { key: "customer.name", label: "Customer" },
      dateCol("validUntil", "Valid until"),
      { key: "revision", label: "Revision" },
      statusCol,
    ],
  },
  subscriptions: {
    title: "Subscriptions",
    subtitle:
      "Every agreement, billing date and lifecycle change in one place.",
    endpoint: "/subscriptions",
    columns: [
      { key: "number", label: "Subscription" },
      { key: "customer.name", label: "Customer" },
      { key: "interval", label: "Frequency" },
      dateCol("nextBillingAt", "Next billing"),
      statusCol,
    ],
  },
  invoices: {
    title: "Invoices",
    subtitle: "From a verified calculation to a reconciled payment.",
    endpoint: "/invoices",
    columns: [
      { key: "number", label: "Invoice" },
      { key: "customer.name", label: "Customer" },
      dateCol("dueAt", "Due date"),
      amountCol("total", "Total"),
      amountCol("outstanding", "Outstanding"),
      {
        key: "status",
        label: "Status",
        render: (r) => (
          <Badge>
            {r.status === "CONFIRMED"
              ? r.overdue
                ? "OVERDUE"
                : r.paymentStatus
              : r.status}
          </Badge>
        ),
      },
    ],
  },
  payments: {
    title: "Payments",
    subtitle: "Record receipts and allocate funds to issued invoices.",
    endpoint: "/payments",
    create: "Record payment",
    roles: ["ADMIN", "FINANCE"],
    columns: [
      { key: "reference", label: "Reference" },
      { key: "customer.name", label: "Customer" },
      dateCol("receivedAt", "Received"),
      amountCol("amount", "Amount"),
      amountCol("unapplied", "Unapplied"),
      { key: "method", label: "Method" },
    ],
  },
  credits: {
    title: "Credits & refunds",
    subtitle:
      "Every adjustment has a reason, an author and an independent reviewer.",
    endpoint: "/credits",
    create: "Request adjustment",
    roles: ["ADMIN", "FINANCE", "SUPPORT"],
    columns: [
      { key: "reason", label: "Credit reason" },
      { key: "customer.name", label: "Customer" },
      amountCol("amount", "Credit granted"),
      dateCol("expiresAt", "Expires"),
      dateCol("createdAt", "Created"),
    ],
  },
  taxes: {
    title: "Tax rules",
    subtitle:
      "Configure illustrative tax components and preserve them in agreements.",
    endpoint: "/taxes",
    create: "Add tax rule",
    roles: ["ADMIN"],
    columns: [
      { key: "name", label: "Tax rule" },
      { key: "jurisdiction", label: "Jurisdiction" },
      {
        key: "inclusive",
        label: "Price basis",
        render: (r) => (r.inclusive ? "Tax inclusive" : "Tax exclusive"),
      },
      dateCol("startsAt", "Effective from"),
      statusCol,
    ],
  },
  discounts: {
    title: "Discounts",
    subtitle: "Controlled promotions with clear eligibility and expiry.",
    endpoint: "/discounts",
    create: "Create discount",
    roles: ["ADMIN"],
    columns: [
      { key: "code", label: "Code" },
      { key: "type", label: "Type" },
      { key: "value", label: "Value" },
      { key: "used", label: "Applications" },
      dateCol("endsAt", "Expires"),
      statusCol,
    ],
  },
  "quote-templates": {
    title: "Quotation templates",
    subtitle: "A consistent starting point for every customer offer.",
    endpoint: "/quote-templates",
    create: "Create template",
    roles: ["ADMIN"],
    columns: [
      { key: "name", label: "Template" },
      { key: "terms", label: "Terms" },
      { key: "validityDays", label: "Validity (days)" },
    ],
  },
  usage: {
    title: "Usage metering",
    subtitle: "Deduplicated events, billed in arrears from real consumption.",
    endpoint: "/usage",
    create: "Record usage",
    roles: ["ADMIN"],
    columns: [
      { key: "eventId", label: "Event ID" },
      { key: "subscription.number", label: "Subscription" },
      { key: "meter.name", label: "Meter" },
      { key: "quantity", label: "Quantity" },
      dateCol("occurredAt", "Occurred"),
      {
        key: "invoiceId",
        label: "Billing",
        render: (r) => <Badge>{r.invoiceId ? "BILLED" : "UNBILLED"}</Badge>,
      },
    ],
  },
  notifications: {
    title: "Notification center",
    subtitle: "Delivery history, retry attempts and operational visibility.",
    endpoint: "/notifications",
    columns: [
      { key: "subject", label: "Notification" },
      { key: "recipient", label: "Recipient" },
      statusCol,
      { key: "attempts", label: "Attempts" },
      dateCol("createdAt", "Queued"),
    ],
  },
  audit: {
    title: "Audit trail",
    subtitle: "An append-only history of security and business operations.",
    endpoint: "/audit",
    columns: [
      { key: "action", label: "Action" },
      { key: "actorId", label: "Actor" },
      { key: "target", label: "Target" },
      dateCol("createdAt", "Recorded"),
      { key: "result", label: "Result" },
    ],
  },
  staff: {
    title: "Team & access",
    subtitle: "Invite colleagues and control their workspace permissions.",
    endpoint: "/staff",
    create: "Invite team member",
    roles: ["ADMIN"],
    columns: [
      { key: "name", label: "Team member" },
      { key: "email", label: "Email" },
      { key: "role", label: "Role", render: (r) => <Badge>{r.role}</Badge> },
      {
        key: "twoFactorEnabled",
        label: "MFA",
        render: (r) => (r.twoFactorEnabled ? "Enabled" : "Enrollment required"),
      },
      {
        key: "suspended",
        label: "Access",
        render: (r) => <Badge>{r.suspended ? "SUSPENDED" : "ACTIVE"}</Badge>,
      },
    ],
  },
  billing: {
    title: "Billing operations",
    subtitle:
      "Durable jobs, bounded recovery and a complete execution history.",
    endpoint: "/billing/jobs",
    columns: [
      { key: "kind", label: "Job type" },
      { key: "key", label: "Period identity" },
      statusCol,
      { key: "attempts", label: "Attempts" },
      { key: "lastError", label: "Last error" },
      dateCol("createdAt", "Queued"),
    ],
  },
  integrity: {
    title: "ProofBill",
    subtitle:
      "Deterministic checks. Traceable discrepancies. Reviewed corrections.",
    endpoint: "/integrity",
    columns: [
      { key: "kind", label: "Finding" },
      { key: "invoice.number", label: "Invoice" },
      {
        key: "severity",
        label: "Severity",
        render: (r) => <Badge>{r.severity}</Badge>,
      },
      statusCol,
      dateCol("createdAt", "Detected"),
    ],
  },
};
const selectField = (
  name: string,
  label: string,
  items: RecordData[],
  labelKey = "name",
  required = true,
): Field => ({
  name,
  label,
  type: "select",
  required,
  options: items.map((i) => ({ value: i.id, label: text(value(i, labelKey)) })),
});
const select = (
  name: string,
  label: string,
  options: string[],
  initial?: string,
): Field => ({
  name,
  label,
  type: "select",
  required: true,
  options: options.map((v) => ({ value: v, label: v.replaceAll("_", " ") })),
  initial,
});
const f = (
  name: string,
  label: string,
  type = "text",
  initial?: string,
  required = true,
): Field => ({ name, label, type, initial, required });
const today = () => new Date().toISOString().slice(0, 16);
function serializeFields(resource: string, v: Record<string, string>): unknown {
  if (resource === "products")
    return { ...v, salesPrice: v.salesPrice, costPrice: v.costPrice || "0" };
  if (resource === "customers")
    return { ...v, paymentTerms: Number(v.paymentTerms || 14) };
  if (resource === "plans")
    return {
      ...v,
      price: v.price,
      minQuantity: Number(v.minQuantity || 1),
      trialDays: Number(v.trialDays || 0),
      packageSize: Number(v.packageSize || 1),
      taxId: v.taxId || undefined,
      usageRate: v.usageRate || "0",
      includedUsage: v.includedUsage || "0",
      setupFee: v.setupFee || "0",
    };
  if (resource === "discounts")
    return {
      ...v,
      value: v.value,
      startsAt: new Date(v.startsAt!).toISOString(),
      endsAt: new Date(v.endsAt!).toISOString(),
      usageLimit: v.usageLimit ? Number(v.usageLimit) : undefined,
    };
  if (resource === "taxes")
    return {
      name: v.name,
      jurisdiction: v.jurisdiction,
      startsAt: new Date(v.startsAt!).toISOString(),
      inclusive: v.inclusive === "true",
      components: [
        { name: v.componentName, rate: v.rate },
        ...(v.component2Name
          ? [{ name: v.component2Name, rate: v.rate2 || "0" }]
          : []),
      ],
    };
  if (resource === "quote-templates")
    return { ...v, validityDays: Number(v.validityDays) };
  if (resource === "payments")
    return {
      customerId: v.customerId,
      reference: v.reference,
      amount: v.amount,
      currency: v.currency,
      method: v.method,
      receivedAt: new Date(v.receivedAt!).toISOString(),
      notes: v.notes || "",
      allocations: v.invoiceId
        ? [{ invoiceId: v.invoiceId, amount: v.allocated || v.amount }]
        : [],
    };
  if (resource === "credits")
    return { ...v, paymentId: v.paymentId || undefined };
  if (resource === "usage")
    return { ...v, occurredAt: new Date(v.occurredAt!).toISOString() };
  return v;
}
function fieldsFor(
  resource: string,
  lookups: Record<string, RecordData[]>,
): Field[] {
  const currency = select(
    "currency",
    "Currency",
    ["INR", "USD", "EUR", "GBP"],
    "INR",
  );
  const customer = selectField(
    "customerId",
    "Customer",
    lookups.customers ?? [],
  );
  switch (resource) {
    case "customers":
      return [
        f("name", "Customer name"),
        f("email", "Email address", "email"),
        f("company", "Company", "text", "", false),
        f("phone", "Phone", "tel", "", false),
        currency,
        f("paymentTerms", "Payment terms (days)", "number", "14"),
        f("billingAddress", "Billing address", "textarea", "", false),
      ];
    case "products":
      return [
        f("name", "Product name"),
        f("category", "Category", "text", "Software"),
        currency,
        f("salesPrice", "Sales price", "number", "0"),
        f("costPrice", "Cost price", "number", "0"),
        f("description", "Description", "textarea", "", false),
      ];
    case "plans":
      return [
        selectField("productId", "Product", lookups.products ?? []),
        f("name", "Plan name"),
        currency,
        select(
          "interval",
          "Billing frequency",
          ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
          "MONTHLY",
        ),
        select(
          "pricingModel",
          "Pricing model",
          ["FLAT", "PER_SEAT", "QUANTITY", "PACKAGE", "USAGE", "HYBRID"],
          "PER_SEAT",
        ),
        f("price", "Recurring unit / base price", "number", "0"),
        f("minQuantity", "Minimum quantity", "number", "1"),
        f("packageSize", "Units per package", "number", "1"),
        f("setupFee", "One-time setup fee", "number", "0"),
        f("trialDays", "Trial days", "number", "0"),
        selectField("taxId", "Tax rule", lookups.taxes ?? [], "name", false),
        f("usageRate", "Usage unit price", "number", "0"),
        f("includedUsage", "Included usage per invoice", "number", "0"),
        f("description", "Plan description", "textarea", "", false),
      ];
    case "discounts":
      return [
        f("code", "Discount code"),
        select("type", "Discount type", ["PERCENT", "FIXED"], "PERCENT"),
        f("value", "Value", "number", "10"),
        f("minimum", "Minimum eligible amount", "number", "0"),
        f("startsAt", "Effective from", "datetime-local", today()),
        f(
          "endsAt",
          "Expires at",
          "datetime-local",
          new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16),
        ),
        f("usageLimit", "Maximum applications", "number", "", false),
      ];
    case "taxes":
      return [
        f("name", "Tax rule name"),
        f("jurisdiction", "Jurisdiction", "text", "IN"),
        select("inclusive", "Price includes tax", ["false", "true"], "false"),
        f("startsAt", "Effective from", "datetime-local", today()),
        f("componentName", "First component name", "text", "CGST"),
        f("rate", "First component rate (%)", "number", "9"),
        f("component2Name", "Second component name", "text", "SGST", false),
        f("rate2", "Second component rate (%)", "number", "9", false),
      ];
    case "quote-templates":
      return [
        f("name", "Template name"),
        f("validityDays", "Default validity days", "number", "30"),
        f("terms", "Payment and service terms", "textarea"),
      ];
    case "staff":
      return [
        f("email", "Colleague email", "email"),
        select(
          "role",
          "Role",
          ["SALES", "FINANCE", "SUPPORT", "ADMIN"],
          "SALES",
        ),
      ];
    case "payments":
      return [
        customer,
        f("reference", "Unique bank / transaction reference"),
        f("amount", "Payment received", "number"),
        currency,
        select(
          "method",
          "Payment method",
          ["BANK_TRANSFER", "CASH", "CHEQUE", "OTHER"],
          "BANK_TRANSFER",
        ),
        f("receivedAt", "Received at", "datetime-local", today()),
        selectField(
          "invoiceId",
          "Allocate to invoice",
          lookups.invoices ?? [],
          "number",
          false,
        ),
        f(
          "allocated",
          "Amount to allocate (blank = payment)",
          "number",
          "",
          false,
        ),
        f("notes", "Notes", "textarea", "", false),
      ];
    case "credits":
      return [
        customer,
        select(
          "kind",
          "Adjustment type",
          ["CREDIT_NOTE", "PREPAID", "GRANT", "REFUND"],
          "CREDIT_NOTE",
        ),
        f("amount", "Amount", "number"),
        currency,
        selectField(
          "paymentId",
          "Payment (required for refunds)",
          lookups.payments ?? [],
          "reference",
          false,
        ),
        f("reason", "Reason for adjustment", "textarea"),
      ];
    case "usage":
      return [
        selectField(
          "subscriptionId",
          "Subscription",
          lookups.subscriptions ?? [],
          "number",
        ),
        selectField("meterId", "Meter", lookups.meters ?? []),
        f("eventId", "Unique source event ID", "text", crypto.randomUUID()),
        f("quantity", "Consumed units", "number"),
        f("occurredAt", "Event timestamp", "datetime-local", today()),
      ];
    default:
      return [];
  }
}
export function CreateRecord({
  resource,
  close,
  toast,
}: {
  resource: string;
  close: () => void;
  toast: (s: string) => void;
}) {
  const qc = useQueryClient();
  const lookupNames =
    resource === "plans"
      ? ["products", "taxes"]
      : resource === "payments"
        ? ["customers", "invoices"]
        : resource === "credits"
          ? ["customers", "payments"]
          : resource === "usage"
            ? ["subscriptions", "meters"]
            : [];
  const q = useQuery({
    queryKey: ["lookups", resource],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          lookupNames.map(async (n) => [
            n,
            (
              await api<PageData>(
                n === "meters" ? "/usage/meters" : `/${n}?limit=100`,
              )
            ).items,
          ]),
        ),
      ),
  });
  const mutation = useMutation({
    mutationFn: (v: Record<string, string>) =>
      api(
        resource === "staff"
          ? "/staff/invite"
          : resource === "credits"
            ? "/adjustments"
            : `/${resource}`,
        serializeFields(resource, v),
      ),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast("Record saved successfully");
      close();
    },
  });
  return (
    <Modal
      title={resources[resource]?.create ?? "Create record"}
      close={close}
      wide={resource === "plans"}
    >
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <Form
          fields={fieldsFor(resource, q.data)}
          onSubmit={(v) => mutation.mutate(v)}
          pending={mutation.isPending}
          error={mutation.error}
        />
      )}
    </Modal>
  );
}
export function QuoteCreator({
  close,
  toast,
}: {
  close: () => void;
  toast: (s: string) => void;
}) {
  const qc = useQueryClient(),
    [lines, setLines] = useState([
      {
        planVersionId: "",
        quantity: "1",
        variantId: "",
        addonIds: [] as string[],
      },
    ]);
  const q = useQuery({
    queryKey: ["quote-lookups"],
    queryFn: async () => {
      const [customers, plans, products, templates, discounts] =
        await Promise.all(
          [
            "/customers?limit=100",
            "/plans?limit=100",
            "/products?limit=100",
            "/quote-templates",
            "/discounts",
          ].map((p) => api<PageData>(p)),
        );
      return {
        customers: customers!.items,
        plans: plans!.items,
        products: products!.items,
        templates: templates!.items,
        discounts: discounts!.items,
      };
    },
  });
  const mutation = useMutation({
    mutationFn: (v: Record<string, string>) =>
      api("/quotes", {
        customerId: v.customerId,
        templateId: v.templateId || undefined,
        discountId: v.discountId || undefined,
        validUntil: new Date(v.validUntil!).toISOString(),
        lines: lines.map((l) => ({
          ...l,
          quantity: Number(l.quantity),
          variantId: l.variantId || undefined,
        })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      toast("Draft quotation created");
      close();
    },
  });
  const change = (index: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  return (
    <Modal title="Create quotation" close={close} wide>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <Form
          fields={[
            selectField("customerId", "Customer", q.data.customers),
            selectField(
              "templateId",
              "Quotation template",
              q.data.templates,
              "name",
              false,
            ),
            selectField(
              "discountId",
              "Discount",
              q.data.discounts,
              "code",
              false,
            ),
            f(
              "validUntil",
              "Valid until",
              "datetime-local",
              new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16),
            ),
          ]}
          submit="Create draft quotation"
          onSubmit={(v) => mutation.mutate(v)}
          pending={mutation.isPending}
          error={mutation.error}
          extra={
            <div className="quote-lines">
              <h3>Subscription lines</h3>
              {lines.map((line, index) => {
                const plan = q.data.plans.find((p) =>
                  (p.versions as RecordData[]).some(
                    (v) => v.id === line.planVersionId,
                  ),
                );
                const product = q.data.products.find(
                  (p) => p.id === plan?.productId,
                );
                return (
                  <div className="quote-line" key={index}>
                    <label>
                      Plan
                      <select
                        aria-label={`Plan for line ${index + 1}`}
                        required
                        value={line.planVersionId}
                        onChange={(e) =>
                          change(index, {
                            planVersionId: e.target.value,
                            variantId: "",
                            addonIds: [],
                          })
                        }
                      >
                        <option value="">Select plan…</option>
                        {q.data.plans
                          .filter((p) => p.active)
                          .map((p) => {
                            const v = (p.versions as RecordData[])[0]!;
                            return (
                              <option key={v.id} value={v.id}>
                                {text(p.name)} · {text(v.interval)} ·{" "}
                                {fmtMoney(v.price, text(v.currency))}
                              </option>
                            );
                          })}
                      </select>
                    </label>
                    <label>
                      Quantity
                      <input
                        aria-label={`Quantity for line ${index + 1}`}
                        type="number"
                        min="1"
                        required
                        value={line.quantity}
                        onChange={(e) =>
                          change(index, { quantity: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Variant
                      <select
                        value={line.variantId}
                        onChange={(e) =>
                          change(index, { variantId: e.target.value })
                        }
                      >
                        <option value="">Standard edition</option>
                        {((product?.variants as RecordData[]) ?? [])
                          .filter((v) => v.active)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {text(v.name)} (+{text(v.priceAdjustment)})
                            </option>
                          ))}
                      </select>
                    </label>
                    {((product?.addons as RecordData[]) ?? []).map((a) => (
                      <label className="check-label" key={a.id}>
                        <input
                          type="checkbox"
                          checked={line.addonIds.includes(a.id)}
                          onChange={(e) =>
                            change(index, {
                              addonIds: e.target.checked
                                ? [...line.addonIds, a.id]
                                : line.addonIds.filter((id) => id !== a.id),
                            })
                          }
                        />
                        {text(a.name)} +{fmtMoney(a.price)}
                      </label>
                    ))}
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="button subtle"
                        onClick={() =>
                          setLines((ls) => ls.filter((_, i) => i !== index))
                        }
                      >
                        Remove line
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="button"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    {
                      planVersionId: "",
                      quantity: "1",
                      variantId: "",
                      addonIds: [],
                    },
                  ])
                }
              >
                <Plus size={16} />
                Add another line
              </button>
            </div>
          }
        />
      )}
    </Modal>
  );
}
type ActionModal = {
  title: string;
  fields: Field[];
  path: string;
  method?: string;
  transform?: (v: Record<string, string>) => unknown;
};
export function ResourcePage({
  resource,
  user,
  toast,
}: {
  resource: string;
  user: User;
  toast: (s: string) => void;
}) {
  const def = resources[resource]!,
    nav = useNavigate(),
    qc = useQueryClient(),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [create, setCreate] = useState(false),
    [action, setAction] = useState<ActionModal | null>(null),
    [scanCursor, setScanCursor] = useState<string | null>(null);
  useEffect(() => {
    setPage(1);
    setSearch("");
    setStatus(new URLSearchParams(window.location.search).get("status") ?? "");
    setCreate(false);
  }, [resource]);
  const q = useQuery({
    queryKey: [resource, page, search, status],
    queryFn: () =>
      api<PageData>(
        `${def.endpoint}?page=${page}&search=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}`,
      ),
  });
  const mutation = useMutation({
    mutationFn: ({
      path,
      body,
      method,
    }: {
      path: string;
      body: unknown;
      method?: string;
    }) => api<Record<string, unknown>>(path, body, method),
    onSuccess: (data) => {
      void qc.invalidateQueries();
      setAction(null);
      toast("Operation completed");
      if (resource === "integrity")
        setScanCursor(
          typeof data.nextCursor === "string" ? data.nextCursor : null,
        );
    },
  });
  const run = (path: string, body: unknown = {}, method?: string) =>
    mutation.mutate({ path, body, method });
  const finance = ["ADMIN", "FINANCE"].includes(user.role),
    admin = user.role === "ADMIN";
  function rowActions(r: RecordData) {
    return (
      <>
        {resource === "quotes" &&
          ["ADMIN", "SALES"].includes(user.role) &&
          r.status === "DRAFT" && (
            <button
              className="table-button"
              onClick={() => run(`/quotes/${r.id}/send`)}
            >
              Send <ArrowUpRight size={14} />
            </button>
          )}
        {resource === "invoices" && finance && r.status === "DRAFT" && (
          <button
            className="table-button"
            onClick={() => {
              if (
                confirm(
                  "Confirm this invoice? Its financial terms will become immutable.",
                )
              )
                run(`/invoices/${r.id}/confirm`);
            }}
          >
            Confirm <FileCheck2 size={14} />
          </button>
        )}
        {resource === "invoices" &&
          ["ADMIN", "FINANCE", "CUSTOMER"].includes(user.role) &&
          r.status === "CONFIRMED" &&
          Number(r.outstanding) > 0 && (
            <Link className="table-button" to={`/checkout/${r.id}`}>
              Pay Now <CircleDollarSign size={14} />
            </Link>
          )}
        {resource === "staff" && admin && r.id !== user.id && (
          <button
            className="table-button"
            onClick={() => {
              if (
                confirm(
                  `${r.suspended ? "Restore" : "Suspend"} access for ${text(r.email)}? Active sessions will be revoked.`,
                )
              )
                run(`/staff/${r.id}`, { suspended: !r.suspended }, "PATCH");
            }}
          >
            {r.suspended ? "Reactivate" : "Suspend"}
          </button>
        )}
        {["products", "plans"].includes(resource) && admin && (
          <button
            className="table-button"
            onClick={() =>
              run(`/${resource}/${r.id}`, { active: !r.active }, "PATCH")
            }
          >
            {r.active ? "Archive" : "Restore"}
          </button>
        )}
        {resource === "discounts" && admin && r.active === true && (
          <button
            className="table-button"
            onClick={() =>
              run(`/discounts/${r.id}`, { active: false }, "PATCH")
            }
          >
            Deactivate
          </button>
        )}
        {resource === "billing" && finance && r.status === "DEAD" && (
          <button
            className="table-button"
            onClick={() => run(`/billing/jobs/${r.id}/retry`)}
          >
            Retry
          </button>
        )}
        {resource === "notifications" && admin && r.status === "DEAD" && (
          <button
            className="table-button"
            onClick={() => run(`/notifications/${r.id}/retry`)}
          >
            Retry delivery
          </button>
        )}
        {resource === "payments" && finance && Number(r.unapplied) > 0 && (
          <button
            className="table-button"
            onClick={() =>
              setAction({
                title: "Allocate payment",
                path: `/payments/${r.id}/allocate`,
                fields: [
                  f("invoiceId", "Issued invoice ID"),
                  f(
                    "amount",
                    "Amount to allocate",
                    "number",
                    text(r.unapplied),
                  ),
                ],
              })
            }
          >
            Allocate
          </button>
        )}
        {resource === "integrity" &&
        finance &&
        r.invoiceId &&
        ["DETECTED", "UNDER_REVIEW"].includes(text(r.status)) ? (
          <button
            className="table-button"
            onClick={() =>
              setAction({
                title: "Request draft correction",
                path: `/integrity/${r.id}/request-correction`,
                fields: [f("reason", "Reason for correction", "textarea")],
              })
            }
          >
            Request correction
          </button>
        ) : null}
        {resource === "integrity" &&
          finance &&
          ["DETECTED", "UNDER_REVIEW"].includes(text(r.status)) && (
            <button
              className="table-button"
              onClick={() =>
                setAction({
                  title: "Review discrepancy",
                  path: `/integrity/${r.id}/review`,
                  fields: [
                    select(
                      "action",
                      "Decision",
                      ["REVIEW", "DISMISS", "CORRECTED"],
                      "REVIEW",
                    ),
                    f("reason", "Review reason", "textarea"),
                    f(
                      "adjustmentId",
                      "Approved adjustment ID (if corrected)",
                      "text",
                      "",
                      false,
                    ),
                  ],
                  transform: (v) => ({
                    ...v,
                    adjustmentId: v.adjustmentId || undefined,
                  }),
                })
              }
            >
              Review
            </button>
          )}
        {resource === "integrity" &&
          finance &&
          ["CORRECTED", "DISMISSED"].includes(text(r.status)) && (
            <button
              className="table-button"
              onClick={() =>
                setAction({
                  title: "Resolve discrepancy",
                  path: `/integrity/${r.id}/review`,
                  fields: [f("reason", "Resolution reason", "textarea")],
                  transform: (v) => ({ ...v, action: "RESOLVE" }),
                })
              }
            >
              Resolve
            </button>
          )}
      </>
    );
  }
  const canOpen = [
    "customers",
    "products",
    "plans",
    "quotes",
    "subscriptions",
    "invoices",
  ].includes(resource);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {resource === "integrity"
              ? "BILLING INTELLIGENCE"
              : "YOUR WORKSPACE"}
          </span>
          <h1>{def.title}</h1>
          <p>{def.subtitle}</p>
        </div>
        <div className="heading-actions">
          {resource === "payments" &&
            ["ADMIN", "FINANCE", "CUSTOMER"].includes(user.role) && (
              <Link className="button" to="/payment-history">
                Demo payment history
              </Link>
            )}
          {resource === "customers" &&
            ["ADMIN", "SALES", "FINANCE"].includes(user.role) && (
              <a className="button" href="/api/v1/customers/export">
                <Download size={16} />
                Export
              </a>
            )}
          {resource === "customers" &&
            ["ADMIN", "SALES"].includes(user.role) && (
              <button
                className="button"
                onClick={() =>
                  setAction({
                    title: "Import customers",
                    path: "/customers/import",
                    fields: [f("csv", "CSV content", "textarea")],
                    transform: (v) => ({ csv: v.csv }),
                  })
                }
              >
                Import CSV
              </button>
            )}
          {resource === "billing" && finance && (
            <button
              className="button primary"
              onClick={() => run("/billing/run")}
            >
              <Play size={16} />
              Queue due billing
            </button>
          )}
          {resource === "integrity" && finance && (
            <button
              className="button primary"
              onClick={() =>
                run("/integrity/scan", scanCursor ? { cursor: scanCursor } : {})
              }
            >
              <ShieldCheck size={16} />
              {scanCursor ? "Scan next 500" : "Run verification"}
            </button>
          )}
          {def.create && def.roles?.includes(user.role) && (
            <button className="button primary" onClick={() => setCreate(true)}>
              <Plus size={17} />
              {def.create}
            </button>
          )}
        </div>
      </div>
      {resource === "integrity" && (
        <div className="integrity-banner">
          <ShieldCheck size={28} />
          <div>
            <h3>Trust is built into every bill.</h3>
            <p>
              Verify invoice snapshots, prices, taxes, discounts, credits and
              missing periods. Financial corrections preserve issued records.
            </p>
          </div>
          <span className="tag">DETERMINISTIC ENGINE</span>
        </div>
      )}
      <ErrorBox error={mutation.error} />
      <section className="panel">
        <div className="table-toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label={`Search ${def.title}`}
              placeholder={`Search ${def.title.toLowerCase()}…`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="toolbar-right">
            {["invoices", "subscriptions", "quotes", "integrity"].includes(
              resource,
            ) && (
              <select
                aria-label="Filter status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                {(resource === "invoices"
                  ? ["DRAFT", "CONFIRMED", "PAID", "OUTSTANDING", "OVERDUE"]
                  : resource === "subscriptions"
                    ? ["CONFIRMED", "ACTIVE", "PAUSED", "CLOSED"]
                    : resource === "quotes"
                      ? ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"]
                      : [
                          "DETECTED",
                          "UNDER_REVIEW",
                          "CORRECTED",
                          "DISMISSED",
                          "RESOLVED",
                        ]
                ).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            <button
              aria-label="Refresh records"
              className="icon-button"
              onClick={() => void q.refetch()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : (
          <>
            <Table
              items={q.data.items}
              columns={def.columns}
              actions={rowActions}
              onOpen={canOpen ? (r) => nav(`/${resource}/${r.id}`) : undefined}
            />
            <Pagination
              page={page}
              total={q.data.total ?? q.data.items.length}
              setPage={setPage}
            />
          </>
        )}
      </section>
      {resource === "credits" && q.data && (
        <section className="panel secondary-panel">
          <div className="panel-title">
            <h2>Adjustment requests</h2>
            <span className="muted">Independent approval required</span>
          </div>
          <Table
            items={(q.data.adjustments as RecordData[]) ?? []}
            columns={[
              { key: "kind", label: "Type" },
              { key: "customer.name", label: "Customer" },
              amountCol("amount", "Amount"),
              { key: "reason", label: "Reason" },
              statusCol,
            ]}
            actions={(r) =>
              finance &&
              r.status === "REQUESTED" &&
              r.requestedBy !== user.id ? (
                <>
                  <button
                    className="table-button"
                    onClick={() => {
                      if (confirm("Approve this financial adjustment?"))
                        run(`/adjustments/${r.id}/decide`, { approve: true });
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="table-button danger-text"
                    onClick={() =>
                      run(`/adjustments/${r.id}/decide`, { approve: false })
                    }
                  >
                    Reject
                  </button>
                </>
              ) : null
            }
          />
        </section>
      )}
      {create &&
        (resource === "quotes" ? (
          <QuoteCreator close={() => setCreate(false)} toast={toast} />
        ) : (
          <CreateRecord
            resource={resource}
            close={() => setCreate(false)}
            toast={toast}
          />
        ))}
      {action && (
        <Modal title={action.title} close={() => setAction(null)}>
          <Form
            fields={action.fields}
            onSubmit={(v) =>
              run(
                action.path,
                action.transform ? action.transform(v) : v,
                action.method,
              )
            }
            pending={mutation.isPending}
            error={mutation.error}
          />
        </Modal>
      )}
    </>
  );
}
export function DetailPage({
  resource,
  user,
  toast,
}: {
  resource: string;
  user: User;
  toast: (s: string) => void;
}) {
  const { id } = useParams(),
    qc = useQueryClient(),
    [dialog, setDialog] = useState<ActionModal | null>(null);
  const q = useQuery({
    queryKey: [resource, id],
    queryFn: () => api<RecordData>(`/${resource}/${id}`),
  });
  const preview = useQuery({
    queryKey: ["preview", id],
    queryFn: () => api<RecordData>(`/subscriptions/${id}/preview`),
    enabled: resource === "subscriptions",
  });
  const entitlements = useQuery({
    queryKey: ["entitlements", id],
    queryFn: () => api<RecordData>(`/subscriptions/${id}/entitlements`),
    enabled: resource === "subscriptions",
  });
  const plans = useQuery({
    queryKey: ["plans", "change"],
    queryFn: () => api<PageData>("/plans?limit=100"),
    enabled: resource === "subscriptions",
  });
  const mutation = useMutation({
    mutationFn: ({
      path,
      body,
      method,
    }: {
      path: string;
      body: unknown;
      method?: string;
    }) => api(path, body, method),
    onSuccess: () => {
      void qc.invalidateQueries();
      setDialog(null);
      toast("Changes saved");
    },
  });
  const run = (path: string, body: unknown = {}, method?: string) =>
    mutation.mutate({ path, body, method });
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data,
    finance = ["ADMIN", "FINANCE"].includes(user.role),
    admin = user.role === "ADMIN",
    staff = ["ADMIN", "SALES"].includes(user.role),
    lines = (r.lines ?? r.items ?? []) as RecordData[];
  return (
    <>
      <Link className="back-link" to={`/${resource}`}>
        <ArrowLeft size={16} />
        Back to {resources[resource]?.title.toLowerCase()}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{resource.toUpperCase()} DETAIL</span>
          <h1>{text(r.number ?? r.name)}</h1>
          <p>
            {text(
              value(r, "customer.name") ??
                r.description ??
                r.email ??
                "Agreement and activity",
            )}
          </p>
        </div>
        <div className="heading-actions">
          <Badge>{r.status ?? (r.active ? "ACTIVE" : "ARCHIVED")}</Badge>
          {resource === "invoices" &&
            ["ADMIN", "FINANCE", "CUSTOMER"].includes(user.role) &&
            r.status === "CONFIRMED" &&
            Number(r.outstanding) > 0 && (
              <Link className="button primary" to={`/checkout/${r.id}`}>
                Pay Now <CircleDollarSign size={16} />
              </Link>
            )}
          {["quotes", "invoices"].includes(resource) && (
            <a
              className="button"
              target="_blank"
              rel="noreferrer"
              href={`/api/v1/${resource}/${id}/pdf`}
            >
              <Download size={16} />
              View / download PDF
            </a>
          )}
          {resource === "invoices" && finance && r.status === "DRAFT" && (
            <button
              className="button primary"
              onClick={() => {
                if (confirm("Issue this immutable financial document?"))
                  run(`/invoices/${id}/confirm`);
              }}
            >
              Confirm invoice
            </button>
          )}
          {resource === "quotes" &&
            r.status === "SENT" &&
            ["ADMIN", "CUSTOMER"].includes(user.role) && (
              <>
                <button
                  className="button primary"
                  onClick={() => {
                    if (confirm("Accept the quoted contract terms?"))
                      run(`/quotes/${id}/accept`);
                  }}
                >
                  <Check size={16} />
                  Accept quotation
                </button>
                <button
                  className="button"
                  onClick={() => run(`/quotes/${id}/reject`)}
                >
                  Reject
                </button>
              </>
            )}
          {resource === "quotes" && r.status === "DRAFT" && staff && (
            <button
              className="button primary"
              onClick={() => run(`/quotes/${id}/send`)}
            >
              Send quotation
            </button>
          )}
        </div>
      </div>
      <ErrorBox error={mutation.error} />
      {resource === "subscriptions" && (
        <div className="lifecycle-bar">
          {["DRAFT", "QUOTATION", "CONFIRMED", "ACTIVE", "CLOSED"].map(
            (s, i) => (
              <div key={s} className={r.status === s ? "current" : ""}>
                <span>{i + 1}</span>
                {s.toLowerCase()}
              </div>
            ),
          )}
        </div>
      )}
      <div className="detail-grid">
        <section className="panel detail-main">
          <div className="panel-title">
            <h2>
              {resource === "products"
                ? "Product details"
                : resource === "plans"
                  ? "Price version history"
                  : "Agreed line items"}
            </h2>
          </div>
          {lines.length ? (
            <Table
              items={lines}
              columns={[
                { key: "description", label: "Description" },
                { key: "quantity", label: "Quantity" },
                amountCol("unitPrice", "Unit price"),
                ...(resource === "invoices"
                  ? [amountCol("total", "Total")]
                  : []),
              ]}
            />
          ) : resource === "plans" ? (
            <Table
              items={(r.versions as RecordData[]) ?? []}
              columns={[
                { key: "version", label: "Version" },
                { key: "interval", label: "Frequency" },
                amountCol("price", "Price"),
                { key: "pricingModel", label: "Model" },
                dateCol("effectiveAt", "Effective"),
              ]}
            />
          ) : (
            <div className="detail-body">
              <p>{text(r.description ?? r.billingAddress ?? r.company)}</p>
              <dl>
                <dt>Currency</dt>
                <dd>{text(r.currency)}</dd>
                <dt>Email</dt>
                <dd>{text(r.email)}</dd>
                <dt>Tax registration</dt>
                <dd>{text(r.taxId)}</dd>
                <dt>Billing address</dt>
                <dd>{text(r.billingAddress)}</dd>
              </dl>
            </div>
          )}
          {resource === "invoices" && (
            <div className="invoice-totals">
              <div>
                <span>Subtotal</span>
                <strong>{fmtMoney(r.subtotal, text(r.currency))}</strong>
              </div>
              <div>
                <span>Discount</span>
                <strong>−{fmtMoney(r.discountTotal, text(r.currency))}</strong>
              </div>
              <div>
                <span>Tax</span>
                <strong>{fmtMoney(r.taxTotal, text(r.currency))}</strong>
              </div>
              <div>
                <span>Credits applied</span>
                <strong>−{fmtMoney(r.creditTotal, text(r.currency))}</strong>
              </div>
              <div className="grand-total">
                <span>Invoice total</span>
                <strong>{fmtMoney(r.total, text(r.currency))}</strong>
              </div>
              <div>
                <span>Collected</span>
                <strong>{fmtMoney(r.amountPaid, text(r.currency))}</strong>
              </div>
              <div>
                <span>Outstanding</span>
                <strong>{fmtMoney(r.outstanding, text(r.currency))}</strong>
              </div>
            </div>
          )}
          {resource === "quotes" && Boolean(r.preview) && (
            <div className="invoice-totals">
              <div className="grand-total">
                <span>Estimated initial invoice</span>
                <strong>
                  {fmtMoney(value(r.preview, "total"), text(r.currency))}
                </strong>
              </div>
              <p className="muted">
                Usage is billed in arrears; discount eligibility is evaluated at
                each billing date.
              </p>
            </div>
          )}
        </section>
        <aside className="panel detail-aside">
          <h2>
            {resource === "subscriptions"
              ? "Subscription controls"
              : "Record overview"}
          </h2>
          <dl>
            <dt>Reference</dt>
            <dd>{text(r.number ?? r.name)}</dd>
            <dt>Created</dt>
            <dd>{fmtDate(r.createdAt ?? r.issuedAt)}</dd>
            {r.nextBillingAt ? (
              <>
                <dt>Next billing</dt>
                <dd>{fmtDate(r.nextBillingAt)}</dd>
                <dt>Frequency</dt>
                <dd>{text(r.interval)}</dd>
              </>
            ) : null}
            {r.dueAt ? (
              <>
                <dt>Due date</dt>
                <dd>{fmtDate(r.dueAt)}</dd>
                <dt>Payment status</dt>
                <dd>
                  <Badge>{r.paymentStatus}</Badge>
                </dd>
              </>
            ) : null}
            {r.substate ? (
              <>
                <dt>Lifecycle substate</dt>
                <dd>
                  <Badge>{r.substate}</Badge>
                </dd>
              </>
            ) : null}
          </dl>
          {resource === "subscriptions" &&
            ["ADMIN", "SALES", "CUSTOMER"].includes(user.role) && (
              <div className="stack-actions">
                {r.status === "CONFIRMED" && staff && (
                  <button
                    className="button primary"
                    onClick={() =>
                      run(`/subscriptions/${id}/action`, { action: "activate" })
                    }
                  >
                    <Play size={16} />
                    Activate subscription
                  </button>
                )}
                {r.status === "ACTIVE" && (
                  <>
                    <button
                      className="button"
                      onClick={() => {
                        if (
                          confirm(
                            "Pause this subscription? Bill due periods first.",
                          )
                        )
                          run(`/subscriptions/${id}/action`, {
                            action: "pause",
                          });
                      }}
                    >
                      <Pause size={16} />
                      Pause subscription
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        setDialog({
                          title: "Schedule plan change",
                          path: `/subscriptions/${id}/change`,
                          fields: [
                            selectField(
                              "planVersionId",
                              "New plan",
                              (plans.data?.items ?? []).flatMap((p) =>
                                (p.versions as RecordData[])
                                  .slice(0, 1)
                                  .map((v) => ({
                                    ...v,
                                    name: `${text(p.name)} · ${text(v.interval)}`,
                                  })),
                              ),
                            ),
                            f("quantity", "New quantity", "number", "1"),
                          ],
                          transform: (v) => ({
                            ...v,
                            quantity: Number(v.quantity),
                          }),
                        })
                      }
                    >
                      Change at next billing
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        if (
                          confirm(
                            "Cancel at the end of the current billing period?",
                          )
                        )
                          run(`/subscriptions/${id}/action`, {
                            action: "cancel",
                          });
                      }}
                    >
                      <XCircle size={16} />
                      Cancel at period end
                    </button>
                  </>
                )}
                {r.status === "PAUSED" && (
                  <button
                    className="button primary"
                    onClick={() =>
                      run(`/subscriptions/${id}/action`, { action: "resume" })
                    }
                  >
                    <Play size={16} />
                    Resume
                  </button>
                )}
                {["ACTIVE", "PAUSED"].includes(text(r.status)) && (
                  <button
                    className="button"
                    onClick={() =>
                      run(`/subscriptions/${id}/action`, { action: "renew" })
                    }
                  >
                    <RefreshCw size={16} />
                    Renew agreement
                  </button>
                )}
              </div>
            )}
          {resource === "products" && admin && (
            <div className="stack-actions">
              <button
                className="button"
                onClick={() =>
                  setDialog({
                    title: "Create product variant",
                    path: `/products/${id}/variants`,
                    fields: [
                      f("name", "Variant name"),
                      f("sku", "Unique SKU"),
                      f("priceAdjustment", "Additional price", "number", "0"),
                    ],
                  })
                }
              >
                <Plus size={16} />
                Add variant
              </button>
              <button
                className="button"
                onClick={() =>
                  setDialog({
                    title: "Create add-on",
                    path: `/products/${id}/addons`,
                    fields: [
                      f("name", "Add-on name"),
                      f("price", "Recurring add-on price", "number", "0"),
                    ],
                  })
                }
              >
                <Plus size={16} />
                Add optional service
              </button>
            </div>
          )}
          {resource === "customers" &&
            ["ADMIN", "SALES", "SUPPORT", "CUSTOMER"].includes(user.role) && (
              <div className="stack-actions">
                {user.role !== "SUPPORT" && (
                  <button
                    className="button"
                    onClick={() =>
                      setDialog({
                        title: "Update customer profile",
                        path: `/customers/${id}`,
                        method: "PATCH",
                        fields: [
                          f("name", "Name", "text", text(r.name)),
                          f(
                            "company",
                            "Company",
                            "text",
                            text(r.company),
                            false,
                          ),
                          f("phone", "Phone", "text", text(r.phone), false),
                          f(
                            "billingAddress",
                            "Billing address",
                            "textarea",
                            text(r.billingAddress),
                            false,
                          ),
                        ],
                      })
                    }
                  >
                    Edit profile
                  </button>
                )}
                {user.role !== "CUSTOMER" && (
                  <button
                    className="button"
                    onClick={() =>
                      setDialog({
                        title: "Record support note",
                        path: `/customers/${id}/notes`,
                        fields: [f("note", "Support note", "textarea")],
                      })
                    }
                  >
                    Add support note
                  </button>
                )}
              </div>
            )}
        </aside>
      </div>
      {resource === "products" && (
        <div className="detail-grid">
          <section className="panel">
            <div className="panel-title">
              <h2>Available variants</h2>
            </div>
            <Table
              items={(r.variants as RecordData[]) ?? []}
              columns={[
                { key: "name", label: "Edition" },
                { key: "sku", label: "SKU" },
                amountCol("priceAdjustment", "Price adjustment"),
              ]}
            />
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>Optional services</h2>
            </div>
            <Table
              items={(r.addons as RecordData[]) ?? []}
              columns={[
                { key: "name", label: "Add-on" },
                amountCol("price", "Recurring price"),
              ]}
            />
          </section>
        </div>
      )}
      {resource === "invoices" &&
        ["ADMIN", "FINANCE", "CUSTOMER"].includes(user.role) && (
          <AttemptHistory invoiceId={r.id} />
        )}
      {resource === "invoices" && (
        <section className="panel secondary-panel">
          <div className="panel-title">
            <h2>
              <ShieldCheck size={18} />
              Explain this bill
            </h2>
            <Badge>
              {r.snapshotIntact ? "SNAPSHOT VERIFIED" : "REVIEW REQUIRED"}
            </Badge>
          </div>
          <div className="detail-body">
            <p className="muted">
              Recomputed from the saved agreement, tax and discount inputs.
              Expected total:{" "}
              <strong>
                {fmtMoney(value(r.explanation, "total"), text(r.currency))}
              </strong>
            </p>
            {((value(r.explanation, "lines") as RecordData[]) ?? []).map(
              (l, i) => (
                <div className="explanation" key={i}>
                  <strong>{text(l.description)}</strong>
                  <p>{text(l.calculation)}</p>
                </div>
              ),
            )}
          </div>
        </section>
      )}
      {resource === "subscriptions" && (
        <>
          <div className="detail-grid">
            <section className="panel detail-body">
              <h2>
                <CircleDollarSign size={20} />
                Next invoice estimate
              </h2>
              {preview.isPending ? (
                <Loading />
              ) : preview.error ? (
                <ErrorBox error={preview.error} />
              ) : (
                <>
                  <strong className="preview-amount">
                    {fmtMoney(preview.data.total, text(r.currency))}
                  </strong>
                  <p>Next billing {fmtDate(preview.data.nextBillingAt)}</p>
                  <p className="muted">
                    {text(
                      preview.data.uncertainty ??
                        "Fixed contract estimate. Credits and discount limits may change before billing.",
                    )}
                  </p>
                  {preview.data.warning && (
                    <p className="error">{text(preview.data.warning)}</p>
                  )}
                </>
              )}
            </section>
            <section className="panel detail-body">
              <h2>Plan entitlements</h2>
              {entitlements.data ? (
                <>
                  <p>
                    <Badge>{entitlements.data.decision}</Badge>
                  </p>
                  <dl>
                    <dt>Included units</dt>
                    <dd>{text(entitlements.data.included)}</dd>
                    <dt>Unbilled consumption</dt>
                    <dd>{text(entitlements.data.consumed)}</dd>
                    <dt>Remaining allowance</dt>
                    <dd>{text(entitlements.data.remaining)}</dd>
                  </dl>
                </>
              ) : (
                <ErrorBox error={entitlements.error} />
              )}
            </section>
          </div>
          <section className="panel secondary-panel">
            <div className="panel-title">
              <h2>Lifecycle history</h2>
            </div>
            <Table
              items={(r.events as RecordData[]) ?? []}
              columns={[
                { key: "action", label: "Event" },
                { key: "actorId", label: "Actor" },
                dateCol("createdAt", "Recorded"),
              ]}
            />
          </section>
          <section className="panel secondary-panel">
            <div className="panel-title">
              <h2>Invoice history</h2>
            </div>
            <Table
              items={(r.invoices as RecordData[]) ?? []}
              columns={[
                { key: "number", label: "Invoice" },
                amountCol("total", "Total"),
                statusCol,
              ]}
              onOpen={(i) => location.assign(`/invoices/${i.id}`)}
            />
          </section>
        </>
      )}
      {resource === "quotes" &&
        (r.subscriptions as RecordData[])?.length > 0 && (
          <section className="panel detail-body">
            <h2>Converted subscriptions</h2>
            {(r.subscriptions as RecordData[]).map((s) => (
              <Link className="button" key={s.id} to={`/subscriptions/${s.id}`}>
                {text(s.number)} <ArrowUpRight size={16} />
              </Link>
            ))}
          </section>
        )}
      {dialog && (
        <Modal title={dialog.title} close={() => setDialog(null)}>
          <Form
            fields={dialog.fields}
            onSubmit={(v) =>
              run(
                dialog.path,
                dialog.transform ? dialog.transform(v) : v,
                dialog.method,
              )
            }
            error={mutation.error}
            pending={mutation.isPending}
          />
        </Modal>
      )}
    </>
  );
}
