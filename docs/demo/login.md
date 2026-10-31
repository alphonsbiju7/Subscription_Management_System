# Five-role local demonstration

Use **http://localhost:5173**. Development navigation from `127.0.0.1` redirects to the configured `WEB_ORIGIN`, preserving the path and query. Authentication retains strict Origin checks and HttpOnly session cookies. `BETTER_AUTH_URL` must have the same public origin as `WEB_ORIGIN`; use an origin without a trailing slash for `WEB_ORIGIN`.

From the repository root in PowerShell, run these in separate terminals:

```powershell
npm.cmd run db:local
```

```powershell
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd --script-shell=cmd.exe run dev
```

`dev` starts the API, frontend and billing/notification worker together. Individual commands are `npm.cmd run dev:api`, `npm.cmd run dev:web` and `npm.cmd run dev:worker`. Existing dependencies must be installed with `npm.cmd install` on a fresh checkout. Keep the existing local `.env`; never commit it.

| Role | Email |
| --- | --- |
| Admin | admin@brightloop.demo |
| Customer | customer@brightloop.demo |
| Sales | sales@brightloop.demo |
| Finance | finance@brightloop.demo |
| Support | support@brightloop.demo |

The seed generates one shared temporary password, stores only Argon2id hashes in PostgreSQL, and writes credentials to ignored `.local/hackathon-demo-credentials.json` and `.local/hackathon-demo-login.txt`. Open the text file locally in VS Code or run `npm.cmd run demo:users` in your own terminal. Passwords and authenticator secrets are never served by the login helper; Vite denies access to `.local` files.

Admin and Finance retain required MFA. At the authenticator prompt, run locally:

```powershell
npm.cmd run demo:otp -- --hackathon admin
npm.cmd run demo:otp -- --hackathon finance
```

The login helper is development-only and fills an email address. All roles use `/` as their dashboard, with role-specific navigation and customer-scoped data. Sessions survive a refresh; sign-out revokes the session. Unverified ordinary accounts still require email verification, with a resend action on the login page. Development verification messages are written to `.local/mail` by the worker.

The existing seed now reconciles these five users before its original early exit. Reruns preserve passwords, MFA and existing accounts. If an existing demo email has an unknown password or MFA secret, the seed stops rather than resetting it. Recover that account through the existing password-reset/account-recovery flow. Demo provisioning is forbidden in production.

The demo customer has an active Workspace Basic subscription, a compatible monthly Pro plan, a prepared Sales quotation, one settled invoice, a partially allocated invoice, an overdue issued invoice and a draft invoice. Receipts are labelled local simulations; no external payment occurs. Stable fixture identifiers prevent duplicate financial data on repeat runs. No authentication schema migration is needed.

Validation:

```powershell
npm.cmd --script-shell=cmd.exe run typecheck
npm.cmd run lint
npm.cmd test
# Point DATABASE_URL at an isolated migrated test database before this command:
npm.cmd run test:integration
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm.cmd run test:e2e -- tests/e2e/demo-login.spec.ts
npm.cmd --script-shell=cmd.exe run build
```

The browser suite exercises real sign-in, MFA, dashboard role, permitted and forbidden routes, customer ownership, refresh, invalid passwords and logout for all five users. Authentication traces, screenshots and videos are disabled to avoid retaining credentials in browser artifacts. The seed integration test keeps its own ignored credentials per test database so it can run repeatedly.
