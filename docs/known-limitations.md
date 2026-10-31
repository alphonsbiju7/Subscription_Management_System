# Remaining master-prompt work

The complete 32-section scope is not finished. The core workflow is implemented and tested; these boundaries must remain explicit.

## Billing and integrations

- Stripe/Razorpay checkout, SDKs, inbound signature/replay verification and outbound webhooks are **not implemented**. There are no fake payment-success controls. Manual finance receipts work locally.
- Price phases, introductory pricing, scheduled changes beyond the next boundary, interval-changing amendments, consolidated billing, automatic mid-cycle proration postings and complex partial final periods are deferred. Proration is a tested calculator only.
- Eight pricing models are calculated by the engine, but graduated/volume tier configuration is currently through the validated API rather than a visual tier editor.
- One discount per agreement; no stacking. Tax validity/exemption/components are configured snapshots, not automatic jurisdiction determination, GST filing or legal compliance. Changes require new tax/plan versions.
- Credits are append-only grants/applications. Refund approval is limited to unapplied receipts and records approval without external money movement. Allocated-payment reversals and invoice-specific credit-note settlement are deferred.
- Usage supports a single subscription item and sum aggregation. Late events roll forward, with an allowance per invoice. Persisted high-volume aggregations, arbitrary meter formulas, correction/retraction and hard entitlement enforcement in another product are deferred. More than 10,000 unbilled events stops a bill rather than silently dropping usage.
- Closed contracts need new quotations. Complex annual extension/reactivation and contractual end-date rules remain work.

## ProofBill and reports

- ProofBill verifies local saved inputs and canonical hashes, not an independent external ledger. A database owner able to rewrite both a snapshot and hash can defeat local evidence.
- Invoice scans are cursor-paginated at 500. Missing-period scans cover 500 active contracts and 120 periods each, skipping pause/resume history; payment scans cover the latest 1,000 receipts. Full historical/sharded sweeps remain work.
- Duplicate billing/payment references are prevented by database constraints. Every rejected duplicate attempt is not a separate persisted fixture. Real under/overbilled drafts and missing-period fixtures are seeded.
- Automatic corrections apply only to intact unissued draft snapshots with a total discrepancy, with a separate approver. Issued corrections need an expanded credit-note/settlement workflow.
- Current MRR/ARR/ARPA, invoice/cash/receivables/aging/tax/discount/credit metrics work. Cohort new/expansion/contraction/churn MRR, NRR/GRR, LTV, retention, recovery rates and formal recognition accounting are deferred. No invented metrics are displayed.
- MRR reads at most 10,001 active contracts; larger installations need a projection. Recent invoice cards are a latest-record operational view. Cash is customer/currency/date scoped and is not attributed to plan/product filters. Some ancillary views/lookups cap results at 100.
- CSV exports cover up to 10,000 customers or aggregated financial metrics. Bank-statement reconciliation, bulk financial rows and PDF reports are deferred. Revenue recognition is a basic illustrative elapsed-time estimate without correction/refund allocation.

## Security and operations

- Five fixed roles work; editable granular permission sets, database RLS, privileged recovery/passkeys, full breached-password detection, idle-session expiry and universal sensitive-operation reauthentication remain work.
- Better Auth's default session records contain bearer tokens: database access/backups require strong protection. Reset/invite identifiers are hashed; token-containing outbox bodies are encrypted. KMS/storage encryption and retention are operator responsibilities.
- Audit/financial triggers protect application mutations, not a superuser/owning DBA. There is no independent ASVS certification, penetration test or externally notarized audit sink.
- Auth requests have a Content-Length check plus native library handling; a strict streaming cap for chunked requests remains work. General API rate limits are per-process; authentication limits use PostgreSQL.
- Durable queues provide retries/leases/dead letters. SMTP is at least once, not exactly once. Dunning covers overdue reminders and past-due flags plus renewal notices; escalation, provider retries and every trial/upcoming-invoice reminder variant are not complete.
- Docker execution, TLS/reverse proxy cookies, real SMTP and external gateways were unavailable for verification. The Compose profile is a starting point, not a hardened deployment. Runtime containers retain dev dependencies for migrations.
- Backup/restore drills, monitoring/alerts, least-privilege runtime database deployment, digest-pinned images/actions, production key rotation and anonymization are not automatically provisioned.

## UI and testing

- Desktop/mobile navigation and core forms work. Some operations are API-only: plan-version creation, quotation revision, contact management and tax-exemption configuration.
- Browser/integration/unit evidence is not exhaustive coverage of every requested feature or multi-region crash/load testing.
- Local performance measurements cover API requests at five-way concurrency, excluding browser paint and internet latency. See the recorded machine/workload.
