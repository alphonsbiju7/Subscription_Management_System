import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { api, fmtDate, fmtMoney, type RecordData, type User } from "./api";
import {
  Badge,
  Empty,
  ErrorBox,
  Loading,
  Pagination,
  Table,
} from "./components";
import type {
  CheckoutInvoice,
  DemoAttempt,
  DemoMethod,
  DemoOutcome,
  RecoveryCase,
  RecoverySummary,
} from "../../../packages/shared-types/src/payments";
import "./payments.css";

const dateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const methodName = (method: DemoMethod) =>
  ({ UPI: "UPI", CARD: "Credit / Debit Card", NET_BANKING: "Net Banking" })[
    method
  ];
function DemoBanner() {
  return (
    <div className="demo-payment-banner">
      <ShieldCheck size={21} />
      <div>
        <strong>DEMO MODE — simulated payments</strong>
        <p>
          No real money moves. This demo updates your invoice and payment
          history. Do not enter bank or card details.
        </p>
      </div>
    </div>
  );
}
function InvoiceSummary({ invoice }: { invoice: CheckoutInvoice }) {
  return (
    <dl className="payment-facts">
      <div>
        <dt>Invoice</dt>
        <dd>
          <Link to={`/invoices/${invoice.id}`}>{invoice.number}</Link>
        </dd>
      </div>
      <div>
        <dt>Customer</dt>
        <dd>{invoice.customer.name}</dd>
      </div>
      <div>
        <dt>Invoice amount</dt>
        <dd>{fmtMoney(invoice.total, invoice.currency)}</dd>
      </div>
      <div>
        <dt>Due date</dt>
        <dd>{fmtDate(invoice.dueAt)}</dd>
      </div>
      <div>
        <dt>Outstanding balance</dt>
        <dd>{fmtMoney(invoice.outstanding, invoice.currency)}</dd>
      </div>
    </dl>
  );
}
export function DemoCheckout() {
  const { invoiceId } = useParams(),
    navigate = useNavigate(),
    client = useQueryClient();
  const [method, setMethod] = useState<DemoMethod>("UPI");
  const [portion, setPortion] = useState<"FULL" | "HALF">("FULL");
  const [scenario, setScenario] = useState("SUCCESS");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const query = useQuery({
    queryKey: ["checkout", invoiceId],
    queryFn: () =>
      api<{
        invoice: CheckoutInvoice;
        recovery: RecoveryCase | null;
        amounts: Record<"FULL" | "HALF", string>;
      }>(`/invoices/${invoiceId}/checkout`),
    refetchOnMount: "always",
  });
  const payment = useMutation({
    mutationFn: () =>
      api<DemoAttempt>(
        "/payments/demo/checkout",
        { invoiceId, method, portion, scenario },
        "POST",
        requestKey,
      ),
    onSuccess: (result) => {
      void client.invalidateQueries();
      navigate(`/payment-receipts/${result.id}`);
    },
  });
  const change = (fn: () => void) => {
    fn();
    setRequestKey(crypto.randomUUID());
    payment.reset();
  };
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <>
        <Link to="/invoices">Back to invoices</Link>
        <ErrorBox error={query.error} />
      </>
    );
  const { invoice, recovery } = query.data;
  const settled = Number(invoice.outstanding) <= 0;
  return (
    <>
      <Link className="back-link" to={`/invoices/${invoice.id}`}>
        <ArrowLeft size={16} />
        Back to invoice
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CUSTOMER CHECKOUT</span>
          <h1>
            Pay your invoice<span className="title-dot">.</span>
          </h1>
          <p>A simple, simulated checkout for your Brightloop subscription.</p>
        </div>
        <Badge>DEMO MODE</Badge>
      </div>
      <DemoBanner />
      <div className="payment-checkout-grid">
        <section className="panel payment-summary">
          <span className="eyebrow">INVOICE SUMMARY</span>
          <h2>{invoice.number}</h2>
          <InvoiceSummary invoice={invoice} />
          <div className="payment-amount">
            <span>Outstanding</span>
            <strong>{fmtMoney(invoice.outstanding, invoice.currency)}</strong>
            <Badge>{invoice.paymentStatus}</Badge>
          </div>
          {recovery && (
            <div className="payment-recovery-note">
              <Badge>{recovery.status}</Badge>
              <p>
                {recovery.status === "PENDING"
                  ? `Automatic demo retry ${recovery.retryCount + 1} is scheduled for ${dateTime(recovery.nextRetryAt)}. You can also retry manually now.`
                  : recovery.status === "EXHAUSTED"
                    ? "Automatic retries are exhausted. You can make a manual demo payment here or contact finance."
                    : "This recovery case is resolved."}
              </p>
            </div>
          )}
        </section>
        <section className="panel payment-form-panel">
          <h2>Choose a demo payment method</h2>
          <p className="muted">
            These methods simulate a transaction; credentials are never
            collected.
          </p>
          {settled ? (
            <div className="payment-result success">
              <CheckCircle2 size={32} />
              <h2>Invoice already paid</h2>
              <p>There is no outstanding balance to collect.</p>
              <Link className="button" to={`/invoices/${invoice.id}`}>
                View invoice
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!payment.isPending) payment.mutate();
              }}
            >
              <fieldset
                disabled={payment.isPending}
                className="payment-methods"
              >
                <legend className="sr-only">Demo payment method</legend>
                {(
                  [
                    {
                      id: "UPI",
                      icon: Smartphone,
                      caption: "Simulated UPI transfer",
                    },
                    {
                      id: "CARD",
                      icon: CreditCard,
                      caption: "Simulated card payment",
                    },
                    {
                      id: "NET_BANKING",
                      icon: Landmark,
                      caption: "Simulated bank payment",
                    },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.id}
                    className={`payment-method ${method === item.id ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="method"
                      value={item.id}
                      checked={method === item.id}
                      onChange={() => change(() => setMethod(item.id))}
                    />
                    <item.icon size={23} />
                    <span>
                      <strong>{methodName(item.id)}</strong>
                      <small>{item.caption}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <fieldset
                disabled={payment.isPending}
                className="payment-options"
              >
                <legend className="sr-only">Demo payment options</legend>
                <label>
                  <span>Payment portion</span>
                  <select
                    aria-label="Payment portion"
                    value={portion}
                    onChange={(event) =>
                      change(() =>
                        setPortion(event.target.value as "FULL" | "HALF"),
                      )
                    }
                  >
                    <option value="FULL">Full outstanding balance</option>
                    <option value="HALF">
                      Half the outstanding balance (partial payment)
                    </option>
                  </select>
                </label>
                <label>
                  <span>Demo scenario</span>
                  <select
                    aria-label="Demo scenario"
                    value={scenario}
                    onChange={(event) =>
                      change(() => setScenario(event.target.value))
                    }
                  >
                    <option value="SUCCESS">Successful payment</option>
                    <option value="FAIL_ONCE">
                      Temporary failure — automatic retry succeeds
                    </option>
                    <option value="ALWAYS_FAIL">
                      Persistent failure — automatic retries fail
                    </option>
                  </select>
                </label>
              </fieldset>
              <div className="payment-amount">
                <span>Demo amount to pay</span>
                <strong>
                  {fmtMoney(query.data.amounts[portion], invoice.currency)}
                </strong>
              </div>
              <p className="payment-help">
                Your payment amount is checked again before processing.
                Automatic recovery retries collect the full remaining balance.
              </p>
              <ErrorBox error={payment.error} />
              <button
                className="button primary payment-submit"
                disabled={payment.isPending}
              >
                {payment.isPending ? (
                  <>
                    <RefreshCw size={17} className="spin" />
                    Processing demo payment…
                  </>
                ) : (
                  <>
                    Complete Demo Payment
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
export function DemoReceipt() {
  const { attemptId } = useParams();
  const query = useQuery({
    queryKey: ["demo-receipt", attemptId],
    queryFn: () => api<DemoAttempt>(`/payments/demo/attempts/${attemptId}`),
    refetchOnMount: "always",
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorBox error={query.error} />;
  const attempt = query.data,
    success = attempt.outcome === "SUCCESS";
  return (
    <>
      <Link className="back-link" to="/invoices">
        <ArrowLeft size={16} />
        Back to invoices
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEMO PAYMENT RESULT</span>
          <h1>{success ? "Payment receipt" : "Payment unsuccessful"}</h1>
          <p>Your simulated transaction has been saved.</p>
        </div>
        <Badge>DEMO MODE</Badge>
      </div>
      <DemoBanner />
      <section className="panel payment-receipt">
        <div
          role="status"
          className={`payment-result ${success ? "success" : "failure"}`}
        >
          {success ? <CheckCircle2 size={42} /> : <XCircle size={42} />}
          <h2>{success ? "Demo payment successful" : "Demo payment failed"}</h2>
          <strong>{fmtMoney(attempt.amount, attempt.invoice.currency)}</strong>
          <p>
            {success
              ? attempt.invoice.paymentStatus === "PAID"
                ? "Your invoice is fully settled."
                : "Your partial payment is recorded. A balance remains on the invoice."
              : attempt.failureReason}
          </p>
        </div>
        <dl className="payment-facts">
          <div>
            <dt>Demo transaction reference</dt>
            <dd>{attempt.transactionReference}</dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>{methodName(attempt.method)} · DEMO MODE</dd>
          </div>
          <div>
            <dt>Attempt date</dt>
            <dd>{dateTime(attempt.createdAt)}</dd>
          </div>
          <div>
            <dt>Attempt type</dt>
            <dd>
              {attempt.retryNumber
                ? `Recovery retry ${attempt.retryNumber}`
                : "Customer checkout"}
            </dd>
          </div>
        </dl>
        <InvoiceSummary invoice={attempt.invoice} />
        {attempt.recovery && (
          <div className="payment-recovery-note">
            <Badge>{attempt.recovery.status}</Badge>
            <p>
              {attempt.recovery.status === "PENDING"
                ? `Next retry: ${dateTime(attempt.recovery.nextRetryAt)}. We have added a notification to your account.`
                : attempt.recovery.status === "EXHAUSTED"
                  ? "Maximum automatic retries reached. Manual action is required."
                  : "Recovery resolved. Automatic retries have stopped."}
            </p>
          </div>
        )}
        <div className="payment-receipt-actions">
          {Number(attempt.invoice.outstanding) > 0 && (
            <Link
              className="button primary"
              to={`/checkout/${attempt.invoice.id}`}
            >
              {success ? "Pay remaining balance" : "Retry demo payment"}
            </Link>
          )}
          <Link className="button" to={`/invoices/${attempt.invoice.id}`}>
            View invoice
          </Link>
          <Link
            className="button"
            to={`/payment-history?invoiceId=${attempt.invoice.id}`}
          >
            View payment history
          </Link>
          {success && (
            <button className="button" onClick={() => window.print()}>
              Print receipt
            </button>
          )}
        </div>
      </section>
    </>
  );
}
export function RecoveryOverview({ compact = false }: { compact?: boolean }) {
  const query = useQuery({
    queryKey: ["payment-recovery-summary"],
    queryFn: () => api<RecoverySummary>("/payment-recovery/summary"),
    refetchInterval: 5000,
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorBox error={query.error} />;
  return (
    <section
      className="payment-recovery-overview"
      aria-label="Payment recovery summary"
    >
      {compact && (
        <div className="panel-title">
          <div>
            <h2>Demo payment recovery</h2>
            <p>Current totals across all demo recovery cases.</p>
          </div>
          <Link className="text-link" to="/payment-recovery">
            Manage recovery <ArrowRight size={15} />
          </Link>
        </div>
      )}
      <div className="recovery-metrics">
        {(
          [
            {
              key: "failedPayments",
              label: "Failed payment attempts",
              tone: "failure",
            },
            {
              key: "pendingRetries",
              label: "Pending retries",
              tone: "pending",
            },
            {
              key: "recoveredPayments",
              label: "Recovered cases",
              tone: "success",
            },
            {
              key: "exhaustedCases",
              label: "Exhausted cases",
              tone: "failure",
            },
          ] as const
        ).map((metric) => (
          <div key={metric.key} className={`recovery-metric ${metric.tone}`}>
            <span>{metric.label}</span>
            <strong data-testid={`recovery-${metric.key}`}>
              {query.data[metric.key]}
            </strong>
            <small>DEMO MODE · all time</small>
          </div>
        ))}
      </div>
    </section>
  );
}
function RecoveryPolicy({ user }: { user: User }) {
  const client = useQueryClient();
  const [edit, setEdit] = useState(false),
    [days, setDays] = useState("");
  const query = useQuery({
    queryKey: ["recovery-policy"],
    queryFn: () => api<{ retryDays: number[] }>("/payment-recovery/policy"),
  });
  const save = useMutation({
    mutationFn: () =>
      api(
        "/payment-recovery/policy",
        { retryDays: days.split(",").map((value) => Number(value.trim())) },
        "PUT",
      ),
    onSuccess: () => {
      setEdit(false);
      void client.invalidateQueries({ queryKey: ["recovery-policy"] });
    },
  });
  return (
    <div className="recovery-policy">
      <div>
        <strong>Automatic retry policy</strong>
        <p>
          {query.data
            ? `Wait ${query.data.retryDays.join(", ")} days after successive failures. Maximum ${query.data.retryDays.length} automatic retries.`
            : "Loading retry policy…"}{" "}
          Changes apply to new recovery cases.
        </p>
        <ErrorBox error={query.error} />
      </div>
      {user.role === "ADMIN" && !edit && (
        <button
          className="button"
          onClick={() => {
            setDays(query.data?.retryDays.join(",") ?? "1,3,5");
            setEdit(true);
          }}
        >
          Configure schedule
        </button>
      )}
      {edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label>
            <span>Retry delays in days</span>
            <input
              aria-label="Retry delays in days"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              placeholder="1,3,5"
            />
          </label>
          <button className="button primary" disabled={save.isPending}>
            Save schedule
          </button>
          <button
            className="button"
            type="button"
            onClick={() => setEdit(false)}
          >
            Cancel
          </button>
          <ErrorBox error={save.error} />
        </form>
      )}
    </div>
  );
}
function RetryControls({ recovery }: { recovery: RecoveryCase }) {
  const [outcome, setOutcome] = useState<DemoOutcome>(recovery.retryOutcome);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const client = useQueryClient();
  const retry = useMutation({
    mutationFn: () =>
      api<DemoAttempt>(
        `/payment-recovery/${recovery.id}/retry`,
        { expectedRetryCount: recovery.retryCount, outcome },
        "POST",
        requestKey,
      ),
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
  return (
    <div className="recovery-retry-controls">
      <p>
        Run the next scheduled demo retry immediately. Choose the result to
        demonstrate a successful or failed recovery.
      </p>
      <label>
        <span>Immediate demo retry result</span>
        <select
          aria-label="Immediate demo retry result"
          value={outcome}
          disabled={retry.isPending}
          onChange={(event) => {
            setOutcome(event.target.value as DemoOutcome);
            setRequestKey(crypto.randomUUID());
            retry.reset();
          }}
        >
          <option value="SUCCESS">Simulate success</option>
          <option value="FAILURE">Simulate failure</option>
        </select>
      </label>
      <button
        className="button primary"
        disabled={retry.isPending || retry.isSuccess}
        onClick={() => retry.mutate()}
      >
        <RefreshCw size={16} className={retry.isPending ? "spin" : ""} />
        {retry.isPending ? "Processing retry…" : "Retry now"}
      </button>
      <ErrorBox error={retry.error} />
    </div>
  );
}
export function PaymentRecovery({ user }: { user: User }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["payment-recovery", search, status, page],
    queryFn: () =>
      api<{ items: RecoveryCase[]; total: number }>(
        `/payment-recovery?page=${page}&search=${encodeURIComponent(search)}&status=${status}`,
      ),
    refetchInterval: 5000,
  });
  if (!["ADMIN", "FINANCE"].includes(user.role))
    return <ErrorBox error="Finance or administrator access is required." />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REVENUE OPERATIONS</span>
          <h1>
            Payment Recovery<span className="title-dot">.</span>
          </h1>
          <p>
            Follow failed demo payments from the first decline to a settled
            invoice.
          </p>
        </div>
        <Link className="button" to="/payment-history">
          View payment history
        </Link>
      </div>
      <DemoBanner />
      <RecoveryOverview />
      <RecoveryPolicy user={user} />
      <section className="panel">
        <div className="table-toolbar">
          <input
            aria-label="Search payment recovery"
            placeholder="Search customer or invoice…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="Recovery status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="RECOVERED">Recovered</option>
            <option value="EXHAUSTED">Exhausted</option>
          </select>
        </div>
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorBox error={query.error} />
        ) : (
          <>
            <Table
              items={query.data.items as unknown as RecordData[]}
              columns={[
                { key: "invoice.customer.name", label: "Customer" },
                { key: "invoice.number", label: "Invoice" },
                {
                  key: "outstanding",
                  label: "Outstanding",
                  render: (row) => {
                    const item = row as unknown as RecoveryCase;
                    return fmtMoney(
                      item.invoice.outstanding,
                      item.invoice.currency,
                    );
                  },
                },
                {
                  key: "retryCount",
                  label: "Retries",
                  render: (row) =>
                    `${row.retryCount} / ${(row.retryDays as number[]).length}`,
                },
                {
                  key: "nextRetryAt",
                  label: "Next retry",
                  render: (row) => dateTime(row.nextRetryAt as string | null),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (row) => <Badge>{row.status}</Badge>,
                },
              ]}
              actions={(row) => (
                <div className="recovery-row-actions">
                  <Link
                    className="table-button"
                    to={`/payment-recovery/${row.id}`}
                  >
                    View details
                  </Link>
                  {row.status === "PENDING" && (
                    <Link
                      className="table-button"
                      to={`/payment-recovery/${row.id}#retry`}
                    >
                      Retry now
                    </Link>
                  )}
                  <Link
                    className="table-button"
                    to={`/payment-history?invoiceId=${row.invoiceId}`}
                  >
                    Payment history
                  </Link>
                </div>
              )}
            />
            <Pagination
              page={page}
              total={query.data.total}
              setPage={setPage}
            />
          </>
        )}
      </section>
    </>
  );
}
export function RecoveryDetail({ user }: { user: User }) {
  const { recoveryId } = useParams();
  const query = useQuery({
    queryKey: ["payment-recovery-detail", recoveryId],
    queryFn: () => api<RecoveryCase>(`/payment-recovery/${recoveryId}`),
    refetchInterval: 5000,
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorBox error={query.error} />;
  const recovery = query.data;
  return (
    <>
      <Link
        className="back-link"
        to={user.role === "CUSTOMER" ? "/invoices" : "/payment-recovery"}
      >
        <ArrowLeft size={16} />
        Back
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">DEMO PAYMENT RECOVERY</span>
          <h1>{recovery.invoice.number}</h1>
          <p>{recovery.invoice.customer.name}</p>
        </div>
        <Badge>{recovery.status}</Badge>
      </div>
      <DemoBanner />
      <div className="payment-checkout-grid">
        <section className="panel payment-summary">
          <InvoiceSummary invoice={recovery.invoice} />
          <dl className="payment-facts">
            <div>
              <dt>Recovery retries</dt>
              <dd>
                {recovery.retryCount} / {recovery.retryDays.length}
              </dd>
            </div>
            <div>
              <dt>Next retry</dt>
              <dd>{dateTime(recovery.nextRetryAt)}</dd>
            </div>
            <div>
              <dt>Resolved</dt>
              <dd>{dateTime(recovery.resolvedAt)}</dd>
            </div>
          </dl>
          <p className="payment-help">
            Last failed attempt: {recovery.lastFailure}
          </p>
          <Link className="button" to={`/invoices/${recovery.invoiceId}`}>
            View invoice
          </Link>
        </section>
        <section className="panel payment-form-panel" id="retry">
          <h2>
            {recovery.status === "RECOVERED"
              ? "Payment recovered"
              : recovery.status === "EXHAUSTED"
                ? "Manual action required"
                : "Next recovery attempt"}
          </h2>
          {recovery.status === "PENDING" &&
          ["ADMIN", "FINANCE"].includes(user.role) ? (
            <RetryControls
              key={`${recovery.id}:${recovery.retryCount}`}
              recovery={recovery}
            />
          ) : (
            <p>
              {recovery.status === "RECOVERED"
                ? "This invoice is settled. Automatic retries have stopped."
                : recovery.status === "EXHAUSTED"
                  ? "The automatic retry limit has been reached. Contact the customer or record a manual receipt. A customer can still complete a new demo checkout."
                  : `Your next automatic retry is scheduled for ${dateTime(recovery.nextRetryAt)}.`}
            </p>
          )}
          {Number(recovery.invoice.outstanding) > 0 && (
            <Link className="button" to={`/checkout/${recovery.invoiceId}`}>
              Open demo checkout
            </Link>
          )}
        </section>
      </div>
      <AttemptHistory invoiceId={recovery.invoiceId} />
    </>
  );
}
export function AttemptHistory({ invoiceId }: { invoiceId?: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["demo-payment-history", invoiceId, page],
    queryFn: () =>
      api<{ items: DemoAttempt[]; total: number }>(
        `/payments/demo/history?page=${page}${invoiceId ? `&invoiceId=${encodeURIComponent(invoiceId)}` : ""}`,
      ),
    refetchInterval: 5000,
  });
  return (
    <section className="panel secondary-panel">
      <div className="panel-title">
        <div>
          <h2>Demo payment history</h2>
          <p>
            Your demo checkout attempts and recovery retries. Every transaction
            is DEMO MODE.
          </p>
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorBox error={query.error} />
      ) : !query.data.items.length ? (
        <Empty>No demo payment attempts yet.</Empty>
      ) : (
        <>
          <Table
            items={query.data.items as unknown as RecordData[]}
            columns={[
              { key: "transactionReference", label: "Demo transaction" },
              { key: "invoice.number", label: "Invoice" },
              {
                key: "amount",
                label: "Amount",
                render: (row) => {
                  const attempt = row as unknown as DemoAttempt;
                  return fmtMoney(attempt.amount, attempt.invoice.currency);
                },
              },
              {
                key: "method",
                label: "Demo method",
                render: (row) => methodName(row.method as DemoMethod),
              },
              {
                key: "createdAt",
                label: "Date",
                render: (row) => dateTime(row.createdAt as string),
              },
              {
                key: "retryNumber",
                label: "Attempt",
                render: (row) =>
                  row.retryNumber ? `Retry ${row.retryNumber}` : "Checkout",
              },
              {
                key: "outcome",
                label: "Result",
                render: (row) => <Badge>{row.outcome}</Badge>,
              },
            ]}
            actions={(row) => (
              <Link className="table-button" to={`/payment-receipts/${row.id}`}>
                {row.outcome === "SUCCESS" ? "View receipt" : "View failure"}
              </Link>
            )}
          />
          <Pagination page={page} total={query.data.total} setPage={setPage} />
        </>
      )}
    </section>
  );
}
export function PaymentHistory() {
  const [params] = useSearchParams();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PAYMENT OPERATIONS</span>
          <h1>Demo payment history</h1>
          <p>
            Successful and failed simulated payments, with their recovery
            attempts.
          </p>
        </div>
        <Link className="button" to="/payments">
          View recorded payments
        </Link>
      </div>
      <DemoBanner />
      <AttemptHistory invoiceId={params.get("invoiceId") ?? undefined} />
    </>
  );
}
