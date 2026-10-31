# Security architecture and threat model

This implementation has automated security checks, not ASVS Level 2 certification or an independent penetration test. The primary trust boundary is between the browser and the API; a second boundary separates application roles from the PostgreSQL owner/migration role; a third separates durable internal financial state from SMTP and optional future payment providers.

| Asset / threat | Implemented control | Residual work |
|---|---|---|
| Account takeover | Argon2id (64 MiB, 3 iterations), verified email, rate-limited login, generic login/reset messages, TOTP and encrypted recovery codes | Breached-password service/common-password corpus beyond the local denylist; passkeys; audited recovery workflow |
| Privileged compromise | MFA mandatory on all admin/finance business routes; fresh sessions for staff invitations/access changes; separate financial approver | Reauthentication for every high-risk financial action and external administrator alerting |
| IDOR / cross-customer exposure | Customer ownership checked for detail, PDF and mutation routes; server-derived list scope; role cannot be supplied at registration | Independent endpoint/property-based BOLA assessment; database RLS is not configured |
| CSRF | Every mutation rejects absent or foreign Origin; exact configured origin; SameSite Lax/HttpOnly cookies; Better Auth's own origin checks | Deploy API behind the same trusted HTTPS origin; do not relax origin validation |
| Session theft | Secure cookies in production, 8-hour expiry, 15-minute update interval, revocation on reset/suspension/staff changes, active-session management | Better Auth's default session records contain bearer tokens; restrict/encrypt database access. A separate idle-session timeout and hashing of session tokens are not implemented |
| Billing duplication | Serializable transactions, per-subscription advisory locks, period/invoice uniqueness, payment reference uniqueness and durable idempotency keys | Multi-host crash/fault-injection testing and production load validation |
| Payment/refund manipulation | Exact cash amounts with <=2 fractional digits, matching currency/customer, balance bounds, independent approval, immutable receipts | Provider checkout/webhooks, allocated-payment refund reversals and external settlement reconciliation |
| SQL / input injection | Prisma parameterization, fixed SQL identifiers, strict Zod bodies, bounded input, CSV parsing, formula-prefix escaping on export | Wider fuzzing and a maintained CSV upload threat assessment |
| XSS | React escaping, no HTML injection, CSP, text-only notifications/PDFs | External CSP report collection and formal accessibility/security review |
| SSRF / file access | No arbitrary server URL fetching; SMTP URL/file access disabled; PDF generation accepts text only | Future outbound webhooks must use destination validation, egress controls and DNS rebinding defenses |
| Insider misuse | Role checks, maker-checker adjustments, append-only SQL triggers and immutable accepted/issued documents | External append-only audit sink, field-level review of all staff read access, granular custom permission editor |
| Secrets / exfiltration | Ignored .env and .local, random local credentials, encrypted email links in the outbox, hashed invitation/reset identifiers, no card data | Managed KMS, production backup encryption/restore exercise, documented organization retention and anonymization policy |
| Denial of service | Auth and API rate limits, 1 MB business bodies, bounded list/worker queries | Global/distributed API limiter, strict streaming body cap on chunked auth requests, larger-volume usage aggregation |
| Worker compromise | Same business transactions and invariants as API; no shell execution or arbitrary payload jobs | Separate worker database credentials/permissions and host hardening |
| Supply chain | Lockfile, npm audit, CI build/tests, pattern secret scan and license inventory | Pin action/container digests, continuous advisory monitoring and reproducible image attestations |

## Password policy

The supplied PDF-compliance policy is enforced at registration, reset and change: **more than eight characters**, uppercase, lowercase and at least one nonalphanumeric nonwhitespace character. Passwords up to 256 characters are allowed; no periodic expiry is imposed. Production also requires at least 14 characters. A small explicit common-password denylist is implemented; a comprehensive compromised-password checker is not. Native Better Auth password verification uses the configured Argon2id functions.

Email verification is always required. Verification/reset messages enter the outbox with an AES-256-GCM encrypted body. Better Auth stores hashed verification identifiers, including reset identifiers. Invite tokens are random 32-byte values stored as SHA-256 hashes. TOTP secrets and backup codes use Better Auth's encryption. Production must protect and rotate `BETTER_AUTH_SECRET`; rotating it without a planned migration can invalidate encrypted MFA and mail data.

## Deployment controls

Production startup rejects HTTP origins. Deploy behind a correctly configured TLS reverse proxy; HTTPS/HSTS cannot be validated solely by the Node process. Keep database and Mailpit ports private. The Compose database is loopback-published for development, and its app profile is a deployment starting point, not a hardened production installation.

Use a distinct non-owner database login in `APP_DATABASE_URL` for production. Grant schema usage, table SELECT/INSERT/UPDATE needed by the application, and sequence usage, but do not grant superuser, DDL, trigger management or DELETE on financial/audit tables. Run migrations with a separate owner credential. Review auth-table deletion needs before applying deny rules. Do not use the default Compose owner URL for production traffic.

Before release: rotate all secrets; remove development credentials and data; provision the first admin through a reviewed DBA action after verified registration; enroll MFA; validate HTTPS cookies and proxy configuration; test encrypted backups and restoration; configure SMTP; test real provider signatures/replays before enabling payments; implement remaining high-risk limitations; run an independent security assessment. Do not treat a successful local npm scan as a production security assurance.
