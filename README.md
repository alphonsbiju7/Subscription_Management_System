# Brightloop SubscriptionOS

Unified subscription management, automated billing, payment operations and revenue visibility for Brightloop Software. Built for the Odoo Virtual Hackathon 2026 from the supplied [implementation brief](docs/requirements/master-prompt.md).

This is a working database-backed **core application**, not the complete enterprise scope in the master prompt or a certified production system. Review the [implementation matrix](docs/requirements/implementation-matrix.md), [limitations](docs/known-limitations.md) and [verification report](docs/testing/README.md).

## Implemented workflows

- Verified registration, Argon2id passwords, reset/change, sessions and privileged TOTP MFA.
- Five server-enforced roles, customer ownership, staff invitations/suspension and append-only audits.
- Products, variants (including Odoo **+560**), add-ons, versioned plans, four billing intervals, taxes and expiring discounts.
- Templates → multiline quotation → acceptance → preserved agreement → activation.
- Separate durable billing worker, exact decimal calculations, missed-period recovery and concurrent duplicate prevention.
- Draft/confirmed invoices, PDF downloads, partial/multiple receipts, allocations and overdue balances.
- Independently reviewed credits, unapplied-payment refunds and draft invoice corrections with before/after evidence.
- Usage billing in arrears, allowance summaries, next-period plan/quantity changes, notifications and ProofBill.
- Real-data dashboards, MRR/ARR/ARPA, receivable aging and CSV exports.

## Stack

React 19 · strict TypeScript · Vite 7 · Tailwind 4 · React Router · TanStack Query · React Hook Form/Zod · Recharts · Express 5 · Better Auth · Prisma 6 · PostgreSQL · Decimal.js · Luxon · PDFKit · Vitest/Supertest · Playwright.

## Fresh checkout without Docker

Requires **Node.js 22.12+** and Git. Recorded verification used Node 24.9. On Windows PowerShell use `npm.cmd`/`npx.cmd` if execution policy blocks `.ps1` launchers.

```sh
git clone https://github.com/alphonsbiju7/Subscription_Management_System.git
cd Subscription_Management_System
npm ci --include=optional
npm run setup
npm run db:generate
```

Terminal 1 starts an embedded **real PostgreSQL** server, with SCRAM authentication and loopback port 55432. Data persists in ignored `.local/postgres`. On Windows, stop it before reinstalling dependencies to release native DLL locks.

```sh
npm run db:local
```

Terminal 2:

```sh
npm run db:migrate
npm run db:seed
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)**. Use the exact host in `WEB_ORIGIN` and `BETTER_AUTH_URL`; localhost and 127.0.0.1 have different cookie/origin identities. Vite proxies `/api` to port 3001. `dev` runs frontend, API and worker together; separate commands are `dev:web`, `dev:api`, `dev:worker`.

`setup` creates an ignored `.env` with random secrets and never overwrites an existing file. Seeding generates random credentials in **`.local/demo-credentials.json`**, including one admin, sales, finance, support and two customers. Admin/finance have generated development authenticators:

```sh
npm run demo:otp -- admin
npm run demo:otp -- finance
```

Use the account password from that local file, then its current code. Seeding is forbidden in production. Never deploy `.local`, demo credentials or the seeded database.

New registrations require email verification. The development worker writes messages to **`.local/mail/*.txt`**. Open the matching verification link. Reset and invitation emails use the same local mailbox. API notification history never returns token-containing bodies.

## Docker alternative

Stop embedded PostgreSQL. Set a random `POSTGRES_PASSWORD` in `.env` and use that password in `DATABASE_URL` on `127.0.0.1:55432/brightloop`.

```sh
docker compose up -d postgres mailpit
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The optional `docker compose --profile app up --build -d` profile requires HTTPS auth/web origins, a TLS reverse proxy and a restricted `APP_DATABASE_URL`; see [operations](docs/operations.md). Docker image/Compose execution was unavailable during verification and is not claimed to have passed.

## Checks and production build

Keep PostgreSQL running. Integration tests create random fixtures without truncating financial history; use a dedicated development/test database.

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm run test:performance
npm audit --audit-level=high
npm run scan:secrets
npm run licenses
npm run docs:api
npm run build
```

Browser tests require seed credentials and start/reuse dev servers. The performance command creates a separate `brightloop_benchmark` database with **1,000 customers, 5,000 subscriptions and 20,000 invoices** and records measured latency. It requires a development database login with database-creation permission and does not fill the main workspace with benchmark records.

Build output is `dist/` (API/worker) and `apps/web/dist/` (frontend). After migrations and production configuration, run `npm start` and `npm run worker` as separate services. There is no mandatory paid external service.

## Financial policies

- Worker billing creates drafts. Finance confirms them before delivery and settlement. Paid status derives only from trusted allocations.
- Monetary inputs are strings. Prices support six fractional digits; receipts/allocations support two. Discounts precede tax, with deterministic half-up document rounding.
- One discount per contract; no stacking. Taxes are illustrative configured snapshots, not automated jurisdiction or filing compliance.
- Usage is billed in arrears from received unbilled events before the boundary; late events roll forward. Single-item metered agreements and 10,000 events per invoice are supported.
- Pause requires due periods to be billed. Resume preserves an unelapsed paid period and otherwise starts a new period without retroactive paused charges.
- Plan/quantity changes apply at the next unbilled boundary. The tested proration calculator is not an automatic mid-cycle accounting integration.
- Refunds are reviewed records against unapplied receipts; they do not send money. Issued documents are immutable. Automatic ProofBill corrections require an intact unissued draft and a separate approver.

## Documentation

- [Architecture and ER diagrams](docs/architecture/README.md)
- [API guide](docs/api/README.md) / [OpenAPI 3.1](docs/api/openapi.json)
- [Security architecture and threat model](docs/security/README.md)
- [Testing and performance evidence](docs/testing/README.md)
- [Demo journey](docs/demo/README.md)
- [Deployment/operations](docs/operations.md)
- [Integrations](docs/integrations.md) / [attribution and licenses](docs/attribution.md)
