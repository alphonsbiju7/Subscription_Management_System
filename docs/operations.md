# Operations and deployment

## Environment

`.env.example` lists supported variables. `npm run setup` generates development secrets. Validate `DATABASE_URL`, a high-entropy `BETTER_AUTH_SECRET` (>=32 characters), auth base URL and exact browser origin before startup. Production requires HTTPS. Keep database/SMTP credentials out of Git and use a secret manager in deployment.

For local development use embedded PostgreSQL or Compose, never both on the same port. The embedded helper explicitly initializes UTF-8 and C locale on Windows. Start the database, run `db:generate`, `db:migrate`, then `db:seed` in nonproduction. Do not run dependency reinstallations while embedded PostgreSQL holds its native DLLs open on Windows.

## Production starting point

1. Provide a PostgreSQL database and separate migration-owner/runtime logins. Set `APP_DATABASE_URL` for the Compose runtime services; its default owner fallback is for development evaluation only.
2. Apply Prisma migrations with the owner credential. Grant runtime schema/table/sequence access needed by Prisma/Better Auth, without DDL, superuser or trigger-management privileges. Deny deletion of financial/audit records and test the effective grants.
3. Build with `npm ci --include=optional`, `npm run db:generate`, `npm run build`. Run API and worker separately or use `docker compose --profile app up --build -d`.
4. Terminate TLS at a trusted reverse proxy and forward to the private API. Configure `WEB_ORIGIN` and `BETTER_AUTH_URL` to that exact HTTPS origin. Do not enable arbitrary trusted-proxy or wildcard CORS behavior.
5. Register and verify the initial operator through the ordinary customer flow; a reviewed DBA operation may promote that exact verified email to ADMIN. Enroll TOTP before business access. No production admin password is supplied by this repository.
6. Configure SMTP (`SMTP_HOST`, `SMTP_PORT`, optional user/password, `SMTP_SECURE`, sender). The worker uses SMTP only in production; development uses `.local/mail`. Validate delivery, retries and alerting in the target environment.
7. Restrict database and Mailpit networking. Bind app-facing ports to the reverse proxy/private network. The Compose loopback PostgreSQL/Mailpit ports are development conveniences.

## Billing operations

Workers claim due jobs with `FOR UPDATE SKIP LOCKED` and a five-minute lease. A tick queues at most 100 due contracts, processes up to ten jobs and 25 messages, and runs reminders each minute. A billing job catches up at most 12 periods; remaining due cursors create later jobs. Five failed attempts cause `DEAD`; review the error in Billing operations, repair the cause, then retry explicitly. Never manually advance a cursor to conceal an unprocessed period.

Invoices begin as drafts. Review/confirm from finance before sending/allocating cash. Invoice confirmation and email outbox insertion are atomic. Notifications do not affect financial commit success. SMTP delivery is at least once: a crash after provider acceptance and before the `SENT` update may resend a stable Message-ID.

Past-due flagging respects the configured grace period and does not silently cancel contracts. Paused agreements are excluded from recurring billing. Expiry/cancellation happens at a boundary. Partial final periods are rejected for explicit review.

## Backup, restore and incident checklist

- Schedule encrypted PostgreSQL backups with retention selected by the business; protect auth/session/MFA data and audit snapshots.
- Restore to an isolated environment regularly, verify schema versions, invoice counts and ownership, then run the tests/ProofBill sweep. No restoration drill was available in this task.
- Monitor health `/api/health`, worker heartbeat/process uptime, due-cursor backlog, dead jobs, failed notification deliveries and discrepancies. A worker-specific durable heartbeat/alert service remains work.
- On account compromise, suspend the user/revoke sessions, review audit events and financial actions, and rotate affected secrets with an MFA/mail encryption migration plan.
- On suspected billing corruption, stop affected billing jobs, preserve the database/audits, recompute snapshots and use reviewed adjustments. Do not disable integrity triggers in production.
- Run dependency/security scans continuously; pin image/action digests and remove unnecessary runtime tools before public deployment. The current image is non-root/read-only in Compose, but retains dev tooling for migration convenience.

Docker image/Compose startup, HTTPS cookies, real SMTP, backups and production permissions remain unverified. See [security](security/README.md) for the threat model and residual controls.
