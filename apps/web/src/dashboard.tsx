import { useState } from "react";
import { Link } from "react-router-dom";
import { RecoveryOverview } from "./payments";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Layers3,
  CircleDollarSign,
  ChartNoAxesCombined,
  Download,
  CalendarDays,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import { api, fmtMoney, fmtDate, type RecordData, type User } from "./api";
import { Loading, ErrorBox, Badge, Table, Empty } from "./components";
type DashboardData = {
  currency: string;
  mrr: string;
  arr: string;
  arpa: string;
  collected: string;
  outstanding: string;
  overdue: string;
  invoiced: string;
  tax: string;
  discount: string;
  credits: string;
  activeSubscriptions: number;
  subscriptionStatus: { status: string; count: number }[];
  trend: { month: string; invoiced: string; collected: string }[];
  aging: { bucket: string; amount: string }[];
  recentInvoices: RecordData[];
  metricsNotes: string;
};
function healthGradient(items: DashboardData["subscriptionStatus"]) {
  const total = items.reduce((n, s) => n + s.count, 0) || 1;
  let angle = 0;
  const colors: Record<string, string> = {
    ACTIVE: "#2aa78d",
    PAUSED: "#d3ad64",
    CLOSED: "#a5afbb",
    CONFIRMED: "#779bc8",
  };
  return `radial-gradient(closest-side, white 78%, transparent 79%), conic-gradient(${
    items
      .map((s) => {
        const start = angle;
        angle += (s.count / total) * 360;
        return `${colors[s.status] ?? "#d1dbe5"} ${start}deg ${angle}deg`;
      })
      .join(",") || "#edf3f1 0deg 360deg"
  })`;
}
export function Dashboard({
  user,
  report = false,
}: {
  user: User;
  report?: boolean;
}) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`),
    [to, setTo] = useState(new Date().toISOString().slice(0, 10)),
    [currency, setCurrency] = useState("INR");
  const [customerId, setCustomerId] = useState(""),
    [productId, setProductId] = useState(""),
    [planId, setPlanId] = useState(""),
    [status, setStatus] = useState("");
  const filters = new URLSearchParams({
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59`).toISOString(),
    currency,
    ...(customerId ? { customerId } : {}),
    ...(productId ? { productId } : {}),
    ...(planId ? { planId } : {}),
    ...(status ? { status } : {}),
  }).toString();
  const q = useQuery({
    queryKey: ["dashboard", filters],
    queryFn: () => api<DashboardData>(`/reports/dashboard?${filters}`),
  });
  const lookups = useQuery({
    queryKey: ["report-lookups"],
    queryFn: async () => {
      const all = await Promise.all(
        ["/customers?limit=100", "/products?limit=100", "/plans?limit=100"].map(
          (p) => api<{ items: RecordData[] }>(p),
        ),
      );
      return all;
    },
    enabled: report,
  });
  const data = q.data,
    isCustomer = user.role === "CUSTOMER";
  const cards = data
    ? [
        {
          label: isCustomer
            ? "Your active subscriptions"
            : "Active subscriptions",
          amount: String(data.activeSubscriptions),
          icon: Layers3,
          meta: "Current active agreements",
          link: "/subscriptions",
        },
        {
          label: "Monthly recurring revenue",
          amount: fmtMoney(data.mrr, currency),
          icon: ChartNoAxesCombined,
          meta: `${fmtMoney(data.arr, currency)} annualized`,
          link: "/reports",
        },
        {
          label: isCustomer ? "Payments made" : "Payments collected",
          amount: fmtMoney(data.collected, currency),
          icon: Wallet,
          meta: "Gross receipts in selected period",
          link: "/payments",
        },
        {
          label: "Outstanding balance",
          amount: fmtMoney(data.outstanding, currency),
          icon: CircleDollarSign,
          meta: `${fmtMoney(data.overdue, currency)} overdue`,
          link: "/invoices?status=OUTSTANDING",
        },
      ]
    : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {report
              ? "REVENUE INTELLIGENCE"
              : isCustomer
                ? "CUSTOMER PORTAL"
                : "BUSINESS AT A GLANCE"}
          </span>
          <h1>
            {report
              ? "Financial reports"
              : isCustomer
                ? `Hello, ${user.name.split(" ")[0]}`
                : "Revenue overview"}
            <span className="title-dot">.</span>
          </h1>
          <p>
            {report
              ? "Follow your revenue, collections and receivables with a clear view of the numbers."
              : isCustomer
                ? "Your subscriptions, invoices and upcoming renewals, together."
                : "A clear view of your subscriptions and the revenue they bring."}
          </p>
        </div>
        {report && ["ADMIN", "FINANCE"].includes(user.role) ? (
          <a className="button" href={`/api/v1/reports/export?${filters}`}>
            <Download size={16} />
            Export report
          </a>
        ) : (
          <Link
            className="button"
            to={isCustomer ? "/subscriptions" : "/reports"}
          >
            {isCustomer ? "View subscriptions" : "View reports"}
            <ArrowUpRight size={16} />
          </Link>
        )}
      </div>
      {!report && ["ADMIN", "FINANCE"].includes(user.role) && (
        <RecoveryOverview compact />
      )}
      <div className="dashboard-filters">
        <span>
          <CalendarDays size={16} />
          Reporting period
        </span>
        <input
          aria-label="From date"
          type="date"
          value={from}
          onChange={(e) => {
            if (e.target.value) setFrom(e.target.value);
          }}
        />
        <span className="muted">to</span>
        <input
          aria-label="To date"
          type="date"
          min={from}
          value={to}
          onChange={(e) => {
            if (e.target.value) setTo(e.target.value);
          }}
        />
        <select
          aria-label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {["INR", "USD", "EUR", "GBP"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {report && lookups.data && (
          <>
            {[
              ["Customer", customerId, setCustomerId],
              ["Product", productId, setProductId],
              ["Plan", planId, setPlanId],
            ].map(([name, selected, set], i) => (
              <select
                key={String(name)}
                aria-label={`${String(name)} filter`}
                value={selected as string}
                onChange={(e) => (set as (v: string) => void)(e.target.value)}
              >
                <option value="">All {String(name).toLowerCase()}s</option>
                {lookups.data[i]!.items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {String(r.name)}
                  </option>
                ))}
              </select>
            ))}
            <select
              aria-label="Subscription status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All contract statuses</option>
              {["ACTIVE", "PAUSED", "CLOSED", "CONFIRMED"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        data && (
          <>
            <div className="stat-grid">
              {cards.map((c, i) => (
                <Link className="stat-card" to={c.link} key={c.label}>
                  <div className="stat-top">
                    <span>{c.label}</span>
                    <c.icon size={18} />
                  </div>
                  <strong>{c.amount}</strong>
                  <div className="stat-bottom">
                    <span className={`stat-indicator indicator-${i}`}>
                      <span />
                    </span>
                    {c.meta}
                  </div>
                </Link>
              ))}
            </div>
            <div className="dashboard-grid">
              <section className="panel chart-panel">
                <div className="panel-title">
                  <div>
                    <h2>
                      {isCustomer
                        ? "Your billing activity"
                        : "Revenue & collections"}
                    </h2>
                    <p>Issued invoices and cash received over time</p>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-invoiced" />
                      Invoiced
                    </span>
                    <span>
                      <i className="legend-cash" />
                      Collected
                    </span>
                  </div>
                </div>
                {data.trend.length ? (
                  <div className="chart">
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart
                        data={data.trend.map((t) => ({
                          ...t,
                          invoiced: Number(t.invoiced),
                          collected: Number(t.collected),
                        }))}
                        margin={{ top: 20, right: 15, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="revenue-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="#24ad92"
                              stopOpacity={0.22}
                            />
                            <stop
                              offset="100%"
                              stopColor="#24ad92"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 5"
                          vertical={false}
                          stroke="#e9edf2"
                        />
                        <XAxis
                          dataKey="month"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#8a94a3", fontSize: 11 }}
                          dy={8}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: "#8a94a3", fontSize: 11 }}
                          tickFormatter={(v) =>
                            Number(v) >= 1000
                              ? `${Number(v) / 1000}k`
                              : String(v)
                          }
                        />
                        <Tooltip
                          formatter={(v) => fmtMoney(v, currency)}
                          contentStyle={{
                            borderRadius: 10,
                            border: "1px solid #e2e8f0",
                          }}
                        />
                        <Area
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="invoiced"
                          stroke="#25ad92"
                          strokeWidth={2.5}
                          fill="url(#revenue-fill)"
                        />
                        <Area
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="collected"
                          stroke="#6387cd"
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          fill="transparent"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <Empty>No activity for this date range.</Empty>
                )}
                <div className="chart-summary">
                  <div>
                    <span className="muted">Issued invoices</span>
                    <strong>{fmtMoney(data.invoiced, currency)}</strong>
                  </div>
                  <div>
                    <span className="muted">Cash collected</span>
                    <strong>{fmtMoney(data.collected, currency)}</strong>
                  </div>
                  <span className="chart-summary-note">
                    Real records.
                    <br />
                    Separate measures.
                  </span>
                </div>
              </section>
              <aside className="panel portfolio-panel">
                <div className="panel-title">
                  <h2>Subscription health</h2>
                  <Layers3 size={18} />
                </div>
                <div
                  className="portfolio-ring"
                  style={{
                    border: 0,
                    background: healthGradient(data.subscriptionStatus),
                  }}
                >
                  <strong>
                    {data.subscriptionStatus.reduce((s, v) => s + v.count, 0)}
                  </strong>
                  <span>Total agreements</span>
                </div>
                <div className="status-list">
                  {data.subscriptionStatus.length ? (
                    data.subscriptionStatus.map((s) => (
                      <Link
                        to={`/subscriptions?status=${s.status}`}
                        key={s.status}
                      >
                        <span>
                          <i
                            className={`status-dot dot-${s.status.toLowerCase()}`}
                          />
                          {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                        </span>
                        <strong>{s.count}</strong>
                      </Link>
                    ))
                  ) : (
                    <p className="muted">No subscriptions yet</p>
                  )}
                </div>
                <Link className="text-link" to="/subscriptions">
                  View all subscriptions <ArrowRight size={15} />
                </Link>
              </aside>
            </div>
            <div className="dashboard-bottom">
              <section className="panel">
                <div className="panel-title">
                  <div>
                    <h2>Recent invoices</h2>
                    <p>Your latest billing activity</p>
                  </div>
                  <Link className="text-link" to="/invoices">
                    View all <ArrowRight size={15} />
                  </Link>
                </div>
                <Table
                  items={data.recentInvoices}
                  columns={[
                    { key: "number", label: "Invoice" },
                    { key: "customer.name", label: "Customer" },
                    {
                      key: "issuedAt",
                      label: "Date",
                      render: (r) => fmtDate(r.issuedAt),
                    },
                    {
                      key: "total",
                      label: "Amount",
                      render: (r) => fmtMoney(r.total, String(r.currency)),
                    },
                    {
                      key: "status",
                      label: "Status",
                      render: (r) => (
                        <Badge>
                          {r.status === "CONFIRMED" &&
                          Number(r.outstanding) <= 0
                            ? "PAID"
                            : r.status}
                        </Badge>
                      ),
                    },
                  ]}
                  onOpen={(r) => location.assign(`/invoices/${r.id}`)}
                />
              </section>
              <aside className="operations-card">
                <div className="operations-icon">
                  <ShieldCheck size={22} />
                </div>
                <span className="eyebrow">CONFIDENCE, BUILT IN</span>
                <h2>
                  Give every bill
                  <br />a second look.
                </h2>
                <p>
                  {["ADMIN", "FINANCE"].includes(user.role)
                    ? "ProofBill checks the math behind your invoices and keeps a traceable record of every finding."
                    : "Open any invoice to see its agreed prices, discounts, tax components and exact calculation."}
                </p>
                <Link
                  className="button"
                  to={
                    ["ADMIN", "FINANCE"].includes(user.role)
                      ? "/integrity"
                      : "/invoices"
                  }
                >
                  {["ADMIN", "FINANCE"].includes(user.role)
                    ? "Open ProofBill"
                    : "Explore your invoices"}
                  <ArrowUpRight size={16} />
                </Link>
              </aside>
            </div>
            {report && (
              <>
                <div className="stat-grid report-cards">
                  {[
                    {
                      name: "Tax on issued invoices",
                      v: data.tax,
                      icon: ArrowUpRight,
                    },
                    {
                      name: "Discounts applied",
                      v: data.discount,
                      icon: ArrowDownLeft,
                    },
                    { name: "Credit impact", v: data.credits, icon: Wallet },
                    {
                      name: "Recurring ARPA",
                      v: data.arpa,
                      icon: CircleDollarSign,
                    },
                  ].map((c) => (
                    <div className="stat-card" key={c.name}>
                      <div className="stat-top">
                        <span>{c.name}</span>
                        <c.icon size={18} />
                      </div>
                      <strong>{fmtMoney(c.v, currency)}</strong>
                    </div>
                  ))}
                </div>
                <section className="panel chart-panel">
                  <div className="panel-title">
                    <h2>Accounts receivable aging</h2>
                    <span className="muted">
                      Unpaid issued invoices in selected period
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={data.aging.map((a) => ({
                        ...a,
                        amount: Number(a.amount),
                      }))}
                    >
                      <CartesianGrid vertical={false} stroke="#e8edf2" />
                      <XAxis
                        dataKey="bucket"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v) => fmtMoney(v, currency)} />
                      <Bar
                        isAnimationActive={false}
                        dataKey="amount"
                        fill="#27a58b"
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </section>
                <p className="report-notes">{data.metricsNotes}</p>
              </>
            )}
          </>
        )
      )}
    </>
  );
}
