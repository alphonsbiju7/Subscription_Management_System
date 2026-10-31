# Demo checkout and smart payment recovery

Every simulated checkout and receipt is labelled **DEMO MODE**. There is no external payment gateway, card/UPI credential collection, bank mandate, or real money movement. Successful simulations create real local Payment/Allocation records, so the existing finance dashboard includes them. Use a development database.

## Run

Install the locked dependencies using `npm ci --include=optional`. For a fresh checkout, run `npm run setup`, then:

```sh
npm run db:generate
# Separate terminal; leave this running
npm run db:local
# Application terminal
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:5173. Existing installations keep their `.env`, accounts, invoices, and payments; the new migration only adds tables, enums, indexes, and guards. Seeding skips an already seeded database. On Windows use `npm.cmd`; if npm is configured to use PowerShell 5 as its script shell, run chained scripts with `npm.cmd --script-shell=cmd.exe run build` (and similarly for `typecheck`).

## Demonstrate

1. Sign in as a **Customer**, using `.local/demo-credentials.json`. Open **Invoices** and select **Pay Now** on an issued invoice with an outstanding balance. Finance/Admin can also use the demo checkout. Drafts need finance confirmation first.
2. The checkout shows the invoice, customer, due date, total, and outstanding balance. Select **UPI**, **Credit / Debit Card**, or **Net Banking**. Do not enter real payment credentials.
3. Select **Successful payment** and **Full outstanding balance**, then **Complete Demo Payment**. The receipt has a `DEMO-...` transaction reference; invoice payment status becomes PAID and the finance totals update. The immutable billing status remains CONFIRMED.
4. To demonstrate partial payment, use another invoice and select **Half the outstanding balance**. The server rounds half of the current remaining balance to cents and records a partial allocation. The remaining balance can be paid later. Existing manual finance receipts still support arbitrary validated partial amounts.
5. On an unpaid invoice select **Temporary failure — automatic retry succeeds**. The result shows the reason, the unchanged invoice balance, and the scheduled retry. The attempt appears in **Demo payment history** and a customer notification appears in **Notifications**. The existing outbox also delivers a local email under `.local/mail`.
6. Sign in as **Admin** or **Finance**, open **Payment Recovery**, search the invoice/customer, and select **View details** or **Retry now**. Choose **Simulate success** and click **Retry now**. A persisted retry pays the full current balance, shows a receipt in history, and marks recovery RECOVERED. The customer can also retry through checkout.
7. For repeated failure, select **Persistent failure — automatic retries fail** during checkout. In Recovery details, select **Simulate failure** for each immediate retry. After the third retry the case is EXHAUSTED, no further automatic attempt is scheduled, and manual action is required. A new manual successful checkout or normal finance receipt can settle it; failed fresh checkouts do not reset its retry budget.
8. On a normal schedule the existing worker processes `DEMO_PAYMENT_RETRY` jobs when due. Keep `dev:worker` running. Defaults wait **1 day after the initial failure, then 3 days after retry 1 fails, then 5 days after retry 2 fails**. Administrators can configure 1–5 delays of 1–30 days in Payment Recovery. Each new case snapshots the policy; existing cases keep their schedule.

The Overview dashboard shows all-time failure, pending, recovered, and exhausted counts from PostgreSQL. Recovery lists display live outstanding balances, not copied invoice totals. Notification bodies containing auth tokens remain private; the existing notification UI displays safe subjects only.

## API

All paths use `/api/v1`, existing cookie sessions, origin validation, ownership checks, and privileged MFA. Every mutation requires an `Idempotency-Key` of 8–120 characters. Financial mutations are serializable transactions using the same customer/invoice locks as manual payments.

| Method | Path                          | Access                          | Behavior                                                                                                 |
| ------ | ----------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/invoices/:id/checkout`      | Customer owner, Admin, Finance  | Live invoice balance and current recovery case                                                           |
| POST   | `/payments/demo/checkout`     | Customer owner, Admin, Finance  | `{invoiceId, method: UPI/CARD/NET_BANKING, portion: FULL/HALF, scenario: SUCCESS/FAIL_ONCE/ALWAYS_FAIL}` |
| GET    | `/payments/demo/history`      | Customer scoped, Admin, Finance | Paginated attempts; `invoiceId`, `customerId`, `status=SUCCESS/FAILURE` filters                          |
| GET    | `/payments/demo/attempts/:id` | Customer owner, Admin, Finance  | Persisted result/receipt with current invoice balance                                                    |
| GET    | `/payment-recovery`           | Admin, Finance                  | Paginated customer/invoice search and status filter                                                      |
| GET    | `/payment-recovery/summary`   | Admin, Finance                  | Database counts of failures and recovery states                                                          |
| GET    | `/payment-recovery/:id`       | Customer owner, Admin, Finance  | Recovery details and current invoice balance                                                             |
| POST   | `/payment-recovery/:id/retry` | Admin, Finance                  | Immediate next retry: `{expectedRetryCount, outcome: SUCCESS/FAILURE}`                                   |
| GET    | `/payment-recovery/policy`    | Admin, Finance                  | Configured delays, default `[1,3,5]`                                                                     |
| PUT    | `/payment-recovery/policy`    | Admin                           | `{retryDays: [1,3,5]}`; applies to new cases                                                             |

Checkout rejects client-supplied amounts/currency and calculates the allocation from the database. A declined simulation returns a persisted FAILURE result with HTTP 201; validation/permission failures use the normal error statuses. Replaying the same key/input returns the original result; different input with that key returns 409. Stale retry versions return 409. Worker jobs use their retry number to skip already processed attempts. A retry and manual receipt racing cannot overcollect.

## Database migration

`202610310006_demo_payment_recovery` adds `DemoPaymentAttempt` and `PaymentRecovery`, linked to existing invoices and payments. Attempts record method, exact amount, result, failure reason, actor, timestamp, reference, and retry number. Recovery has one case per invoice, a snapshotted policy, retry count, next retry date, and terminal resolution state. Constraints enforce positive attempt amounts, valid success/payment links, retry bounds, terminal scheduling rules, and append-only attempt history. The existing Job, Outbox, AuditLog, Idempotency, Payment and Allocation tables are reused. No financial history is rewritten or deleted.

Every successful receipt/allocation, including existing manual finance actions, reconciles recovery. An ACTIVE, unexpired subscription's PAST_DUE hold clears only when all of its overdue issued invoices are paid. Paused, closed and expired subscriptions stay in their existing lifecycle state; payments do not activate contracts. Entitlement responses respect a PAST_DUE hold. Reminder sweeps recheck balances under the same financial locks, so a stale sweep cannot reinstate a hold after settlement.

## Files

Created:

- `apps/api/src/modules/demo-payments.ts`: checkout, attempt history, recovery APIs and retry state machine.
- `apps/api/src/modules/payment-settlement.ts`: shared settlement, recovery reconciliation and eligible hold clearing.
- `apps/web/src/payments.tsx`, `apps/web/src/payments.css`: checkout, receipts, history, recovery dashboard and responsive styles.
- `packages/shared-types/src/payments.ts`: frontend contracts.
- `prisma/migrations/202610310006_demo_payment_recovery/migration.sql`: persisted models and database guards.
- `tests/integration/demo-payments.test.ts`, `tests/e2e/payments.spec.ts`: financial/security and browser coverage.
- `docs/demo/payments.md`: this implementation and demonstration guide.

Modified:

- `prisma/schema.prisma`, `packages/validation/src/index.ts`: relations, enums and validated inputs.
- `apps/api/src/app.ts`, `apps/api/src/modules/finance.ts`: route registration and reuse of transactional payment recording/allocation.
- `apps/api/src/modules/usage.ts`, `apps/api/src/modules/admin.ts`: entitlement hold handling and integration status.
- `apps/worker/src/processor.ts`: durable payment retry dispatch.
- `apps/web/src/api.ts`, `apps/web/src/main.tsx`, `apps/web/src/resources.tsx`, `apps/web/src/dashboard.tsx`: stable request keys, routes/navigation, Pay Now links, invoice attempt history and live recovery totals.
- `playwright.config.ts`, `tests/e2e/journey.spec.ts`: optional installed-browser selection and a separate credential file for isolated browser tests.
- `scripts/generate-openapi.ts`, `docs/api/openapi.json`: generated endpoint and input-schema reference; the route scanner now recognizes both quote styles and multiline declarations.
- `README.md`, `docs/known-limitations.md`, `docs/requirements/implementation-matrix.md`: updated feature scope and boundaries.

## Verification

Verified locally on 31 October 2026: **49 unit tests**, **59 integration/security tests**, and **3 browser journeys** passed (installed Microsoft Edge, including desktop/mobile navigation, the existing quote-to-cash workflow, and demo checkout/recovery). The two workflow browser tests passed on a targeted rerun after fixing stale-row and logout-navigation waits. Lint, TypeScript checks, production build, secret scan, and diff whitespace checks passed. Vite reports non-blocking dependency comment-annotation and bundle-size warnings.

Financial and browser fixtures ran in the separate `brightloop_payment_tests` database. The original `brightloop` database retained all six demo accounts and contained zero test demo-payment attempts. After restarting the original app, the frontend, new checkout module, and database-backed `/api/health` returned HTTP 200.

```sh
npm run lint
npm test
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
```

`tests/integration/demo-payments.test.ts` covers full/partial payments, balances, failure persistence, ownership, forged amounts, idempotent/concurrent requests, worker execution, immediate retries, limits, policy snapshots, manual settlement and database-backed metrics. `tests/e2e/payments.spec.ts` exercises partial checkout, visible failure, finance retries, recovery and a mobile viewport. Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge instead of Playwright Chromium.

## Boundaries

- Simulation outcomes are deliberately selectable. A temporary-failure case defaults to successful automatic retries; a persistent-failure case defaults to failed retries. Operators can choose the immediate demo outcome without changing future scheduled outcomes.
- Automatic recovery retries pay the full outstanding balance; customer checkout supports full or half balance. No real payment authorization is captured.
- Recovery metrics count cases; failed-payment metrics count individual attempts, including retries. Demo receipts contribute to existing financial reports and are identified by `DEMO_` methods, DEMO notes and references.
- The existing durable job infrastructure retries infrastructure errors separately from payment declines. A dead infrastructure job is visible in Billing operations and requires operator review; it does not silently consume a payment retry.
- Receipts can be reopened and printed from their persisted URL. This feature does not add a separate PDF receipt generator, external bank reconciliation, or real refunds.
