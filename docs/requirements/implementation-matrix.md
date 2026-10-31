# Implementation and evidence matrix

Source: [the supplied master prompt](master-prompt.md). **COMPLETE** means the specifically named behavior has implementation and verification evidence, not that its entire source section is complete. PARTIAL identifies a working subset; DEFERRED is absent; UNVERIFIED is supplied but not executed. All remaining scope is explicit in [known limitations](../known-limitations.md).

| Feature | Source | Status | Relevant code / API | Evidence / boundary |
|---|---|---|---|---|
| Strict React/Express workspace, PostgreSQL/Prisma | §§2–3,22 | COMPLETE | package.json, tsconfig; prisma/schema.prisma | Typecheck/build, applied migrations, integration suite |
| Docker/non-root Compose deployment | §§2,23,30 | UNVERIFIED | Dockerfile; docker-compose.yml | Daemon unavailable; deployment guide provided |
| Verified customer registration/normalization/Argon2id | §§5–6 | COMPLETE | auth.ts; /api/auth/sign-up/email | Security tests and browser registration/email journey |
| Login/logout/session revocation | §5 | COMPLETE | Better Auth; /api/auth; /me | Integration logout, password-reset/suspension checks |
| Password reset, single-use hashed token | §5 | COMPLETE | auth.ts; /api/auth/reset-password | auth-finance.test.ts reset/replay/session test |
| Privileged TOTP MFA | §§4–5,23 | COMPLETE | auth.ts/access.ts; account.tsx | API enrollment/gating; real browser MFA sign-in |
| Password change and active sessions UI | §5 | PARTIAL | account.tsx; native Better Auth | Native integration provided; browser coverage limited to login/enrollment |
| Passkeys, breached corpus, idle timeout, full recovery | §§5,23 | DEFERRED | docs/security | Explicit residual controls |
| Fixed roles and customer ownership | §§4,23 | COMPLETE | access.ts; module authorization | IDOR/PDF/mutation/customer-filter/security tests |
| Staff invite/accept/suspend | §§4–5 | COMPLETE | admin.ts; /staff/invite; /me/accept-invite | Hashed-token consumption and session revocation test |
| Editable granular permissions / RLS | §§4,23 | DEFERRED | — | Five fixed roles; app-layer ownership |
| Customer CRUD/search/pagination/profile | §6 | COMPLETE | customers.ts; /customers; resources.tsx | Workflow/browser creation/profile; validation and ownership tests |
| Customer contacts/notes/CSV import/export | §6 | PARTIAL | customers.ts | Validated API, UI import/export/notes; exhaustive CSV/contact tests deferred |
| Products/variants/add-ons/Odoo +560 | §7 | COMPLETE | catalog.ts; /products; seed | Browser product creation; unit variant increment; cost masking test |
| Plan versions and four frequencies | §8 | COMPLETE | catalog.ts; /plans; PlanVersion | API/browser tests; date and amendment tests |
| Flat/seat/quantity/tier/volume/package/usage/hybrid math | §8 | COMPLETE | billing-engine.priceCharge | Unit fixtures for eight pricing models |
| Advanced tier editor | §8 | DEFERRED | Validated API available | UI exposes simpler models |
| Setup/add-ons/negotiated admin quote prices | §§8–9 | PARTIAL | sales.ts/billing.ts; snapshots | Working domain paths; not all combinations have integration fixtures |
| Trials/availability/plan policy | §§8,10 | PARTIAL | PlanVersion; sales.ts/billing.ts | Calendar policies implemented; full trial-edge/browser coverage deferred |
| Introductory pricing/price phases/consolidation | §§8,13 | DEFERRED | — | Requires additional contract/accounting model |
| Quote templates/multiline/send/accept/conversion | §9 | COMPLETE | sales.ts; /quotes | Real role-switched browser journey; integration fixture |
| Quotation revisions and PDF | §9 | PARTIAL | /quotes/:id/revise; documents.ts | Implemented, accepted edits blocked; revision/PDF browser coverage incomplete |
| Exact lifecycle + pause/resume/renew/cancel | §10 | COMPLETE | sales.ts; SubscriptionEvent | Unit transitions, API/browser lifecycle journey |
| Next-boundary compatible plan/quantity changes | §§8,10 | COMPLETE | Amendment; /subscriptions/:id/change | Historical invoice preserved in amendment integration test |
| Automatic mid-cycle proration posting | §10 | DEFERRED | billing-engine.proration calculator exists | Calculator boundary/leap-year tests only; no automatic posting |
| Taxes/components/inclusive/exclusive/exemption | §11 | PARTIAL | billing-engine; tax snapshots | Unit tests; configurable Indian components, no jurisdiction automation/compliance |
| Discount validity/limits/eligibility/cent allocation | §11 | COMPLETE | calculateBill; DiscountApplication | Unit expiry/eligibility/pennies + concurrent one-use test |
| Discount stacking | §11 | DEFERRED | — | One rule per agreement |
| Recurring invoices/idempotency/catch-up | §12 | COMPLETE | billOne/catchUp; BillingPeriod | Duplicate job/two concurrent workers/bounded recovery tests |
| UTC/local anchors/month-end/leap/DST | §12 | COMPLETE | nextBoundary (Luxon) | Date-boundary and DST unit tests |
| Durable queue/retries/leases/history | §§12,17 | PARTIAL | Job/JobRun; processor.ts | Real job execution; multi-host crash/fault injection deferred |
| Invoice issue/payment state/PDF/explanation | §13 | COMPLETE | finance.ts/documents.ts; /invoices | Partial/full settlement, immutability, PDF signature, browser download |
| Manual receipt/multiple allocations/idempotency | §14 | COMPLETE | recordPayment; Allocation | API/browser partial/full, retries, overpayment/reference checks |
| Bank statement import/reconciliation | §14 | DEFERRED | — | Allocation-based reconciliation only |
| Stripe/Razorpay/webhook processing | §§14,21 | DEFERRED | docs/integrations.md | No live provider integration; labelled demo simulations are a separate local feature |
| Demo checkout and smart payment recovery | Hackathon demo | COMPLETE | demo-payments.ts; payment-settlement.ts; payments.tsx; worker | Persisted full/partial receipts, failed attempts, bounded durable retries, ownership and concurrency tests; no real money movement |
| Credit/prepaid grants/expiry/application | §15 | PARTIAL | Adjustment/CreditEntry/CreditApplication | Independent approval and transactionally applied grant test; full expiry policy suite deferred |
| Refund requests/approval/unapplied bounds | §15 | COMPLETE | finance.ts; /adjustments | Maker-checker, double-refund and amount-limit tests; records only |
| Actual refund transfer/allocated reversal/credit-note settlement | §15 | DEFERRED | — | No external money movement or full accounting ledger |
| Usage event IDs/dedup/arrears allowance | §16 | COMPLETE | usage.ts/billing.ts; /usage | Duplicate event consumed once into real invoice |
| Entitlement summaries/access decision | §16 | PARTIAL | /subscriptions/:id/entitlements | Summaries implemented; external product enforcement/hard limits deferred |
| High-volume usage aggregates/corrections | §16 | DEFERRED | — | 10,000-event safety cap; no silent data loss |
| Transactional mail outbox/local delivery | §17 | COMPLETE | Outbox; processor.ts | Injectable delivery integration + real registration email browser test |
| Configurable overdue/renewal reminders | §17 | PARTIAL | queueReminders; settings UI | Working policy code; full escalation/trial/recovery scenarios deferred |
| External SMTP | §17 | UNVERIFIED | Nodemailer transport | Local file sink verified; no external provider |
| Current MRR/ARR/ARPA/invoice/cash/aging | §18 | COMPLETE | reports.ts/dashboard.tsx | Real-record reports in workflow; benchmark against 20,000 invoices |
| Cohort churn/expansion/NRR/GRR/LTV | §18 | DEFERRED | — | No invented metrics |
| Illustrative revenue schedule | §18 | PARTIAL | /reports/revenue-schedule | Straight-line estimate; correction allocation/accounting compliance deferred |
| ProofBill recomputation/quantity/price/tax/credits/periods | §19 | PARTIAL | integrity.ts; /integrity/scan | Altered-draft test; bounded sweeps and coverage restrictions documented |
| Explain Bill / Preview Next Invoice | §19 | COMPLETE | invoice/subscription detail; calculateBill | API/browser real snapshots; received usage uncertainty shown |
| Reviewed draft correction / resolution / evidence | §19 | COMPLETE | request-correction; /adjustments/:id/decide | Independent approver restores draft; before/after audit test |
| Issued-document correction accounting | §19 | DEFERRED | Immutable records preserved | Full credit-note settlement requires extension |
| Responsive role workspaces / portal | §§4,20 | COMPLETE | apps/web/src | Real Chromium desktop/mobile navigation + customer journey |
| Every advanced feature in UI | §20 | PARTIAL | resources.tsx/account.tsx | Some operations explicitly API-only; no decorative payment controls |
| OpenAPI / structured logs / schemas | §21 | PARTIAL | docs/api/openapi.json; app.ts | Generated business path/input schemas; some action/response schemas generic |
| CSRF/RBAC/MFA/headers/CSV/financial constraints | §23 | PARTIAL | auth/access/app; migrations | Automated security tests/audit; no ASVS certification, KMS or pen test |
| Vulnerability/secret/license scans | §23 | COMPLETE | lockfile; scripts; docs | Recorded npm audit and pattern scan; not a guarantee against undiscovered issues |
| 5,000 subscriptions / 20,000 invoices performance | §24 | COMPLETE | tests/performance; performance-results.json | 50 requests/endpoint, concurrency 5, measured p95 below 2 s |
| Unit/API/security/browser suite | §25 | COMPLETE | tests | See final counts and commands in testing report; not exhaustive master-scope coverage |
| Reference product/repository study | §§26–27 | PARTIAL | docs/attribution.md | Requirements and primary integration docs used; no false claim all repositories inspected |
| Random dev credentials / realistic fixtures | §28 | COMPLETE | prisma/seed; .local ignored | Executed seed + browser role journey; no fixed production password |
| Requirements/docs/diagrams/setup/demo/limitations | §§29–32 | COMPLETE | docs and README | Supplied documentation; full enterprise acceptance remains incomplete as listed |

The advanced commercial and operational requirements marked DEFERRED, PARTIAL or UNVERIFIED are not silently accepted as complete. Release review must use these boundaries rather than the application title as a readiness claim.
