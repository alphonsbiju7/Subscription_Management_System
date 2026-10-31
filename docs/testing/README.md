# Verification report

Recorded **31 October 2026** on Windows 11 / Node 24.9.0 using real local PostgreSQL 18 and Chromium. This is reproducible local evidence, not production certification or exhaustive completion of the master prompt.

| Check | Result |
|---|---|
| Fresh committed checkout | Install → setup → generate → build → 32 unit tests → four migrations into a blank isolated database → random seed → API/security tests → both browser journeys all passed |
| `npm ci --include=optional` | Passed in the clean checkout; Windows native dependencies explicitly included in final lockfile. Embedded PostgreSQL must be stopped during reinstall because its DLLs are locked |
| `npm run db:generate` | Passed |
| `npm run db:migrate` | Four migrations applied successfully to development and benchmark databases |
| Prisma live schema → datamodel diff | **No difference detected** |
| `npm run typecheck` | Passed, strict API/worker/shared/frontend TypeScript |
| `npm run lint` | Passed |
| `npm run build` | Passed, frontend and compiled API/worker; one large frontend chunk warning remains (~913 kB uncompressed / 277 kB gzip), plus harmless upstream annotation warnings |
| `npm test` | **32 unit tests passed** |
| `npm run test:integration` | **32 API/integration/security tests passed** in three files, including recovery-token log-path redaction |
| `npm run test:e2e` | **2 Chromium scenarios passed** (22.5 seconds final run) |
| `npm run test:performance` | Passed target on the workload below |
| `npm audit` | **0 vulnerabilities** reported in final lockfile scan |
| `npm run scan:secrets` | No recognized private keys/provider tokens in source; pattern scanning is limited |
| `npm run licenses` | Production dependency inventory generated |
| `npm run docs:api` | 64 business paths generated with principal request schemas |
| `docker compose config --quiet` | Passed syntax/interpolation validation |
| Docker image/Compose execution | **Not run**: daemon unavailable |
| Live SMTP, gateways, TLS deployment | **Not verified**: unavailable/not implemented as documented |

## Tested invariants

- Eight price calculations, exact decimals, tax-inclusive/exclusive components, customer tax exemption, capped discounts/credits, discount validity/limits and deterministic cent allocation.
- Monthly 29/30/31 anchors, February/leap years, yearly/weekly/daily billing, a DST transition, lifecycle rules and prorated start/end/leap-year boundaries.
- Quote acceptance/activation → invoice → confirmation → partial and full cash allocation → report update, with valid PDF bytes.
- Repeated and concurrent billing creates one invoice for a period; daily missed periods recover without skipping the cursor.
- Accepted offers, issued invoices/lines and financial/audit ledgers resist direct database mutation; transactions roll back on failure.
- Separate financial approver, applied credit grants, unapplied-payment refund bounds, double-refund rejection, append-only allocation and durable payment idempotency.
- Usage duplicate identity contributes once to a real invoice; next-period amendments preserve historical invoice terms.
- ProofBill detects altered draft totals, refuses issuing inconsistent data and restores a draft only after independent approval, preserving audit evidence.
- Authentication normalization, Argon2id, weak-password rejection, logout/reset/suspension session invalidation, single-use reset tokens, hashed staff invitations, MFA enrollment gating and credential throttling.
- Customer IDOR/PDF/mutation/list-filter isolation, admin/finance denial, CSRF origin checks, safe error handling, injection-shaped input rejection, cost-field masking, currency/overpayment/reference constraints and cookie/header attributes.

## Browser scenarios

The navigation scenario visits all nineteen operational/configuration modules as an MFA-authenticated admin, waits for their data, captures a desktop dashboard and tests 390×844 mobile navigation/table containment with no page exceptions.

The main journey uses actual browser registration and a verification message delivered by the development worker, then switches between admin, sales, customer and finance sessions to create a product/plan, issue/accept a quotation, activate, queue billing, review/download/confirm an invoice, receive 400 + 600, verify PAID, inspect the customer bill and pause/resume/renew. It uses no mocked browser business data.

Screenshots in `docs/demo` are verification artifacts. The integration suite creates randomly identified records without truncating the development database. Run it against a dedicated database when preserving a clean demonstration dataset matters.

## Performance results

Dataset: **5,000 active subscriptions, 20,000 invoices, 1,000 customers**, associated monthly plan/tax/discount configuration and payment/allocation records. The fixture generator is deterministic and lives in an isolated `brightloop_benchmark` database. Each endpoint receives three warmups followed by **50 requests at concurrency 5**, including real session checks and PostgreSQL queries, through local Express/Supertest.

Machine: AMD Ryzen 7 7445HS, 12 logical cores, 15 GiB reported RAM, Windows 10.0.26200, Node 24.9.0. Full JSON, dataset counts and an `EXPLAIN (ANALYZE, BUFFERS)` billing-query plan are in [performance-results.json](performance-results.json).

| Endpoint | p50 | p95 | Maximum |
|---|---:|---:|---:|
| Subscriptions, first 25 | 27 ms | **113 ms** | 200 ms |
| Invoices, first 25 | 35 ms | **59 ms** | 95 ms |
| Customers, first 25 | 13 ms | **20 ms** | 21 ms |
| Financial dashboard | 436 ms | **569 ms** | 577 ms |

All measured p95 values are below two seconds. These figures exclude browser paint, WAN/TLS latency and external delivery. They do not establish an internet production SLA or performance of every advanced filter/integrity sweep.

## Remaining verification

See [known limitations](../known-limitations.md) for unimplemented commercial features and operational requirements. In particular, live payment/webhook handling, full accounting corrections/revenue recognition, multi-host failure injection, complete ASVS verification, backup restoration, external SMTP and Docker runtime validation remain outside this evidence.
