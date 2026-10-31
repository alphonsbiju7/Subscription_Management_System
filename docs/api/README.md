# REST API

Business routes use `/api/v1`; Better Auth owns `/api/auth`. `/api/openapi.json` serves the generated OpenAPI 3.1 document. Run `npm run docs:api` to regenerate principal request schemas and business routes; some action bodies/responses remain generic in that document and are specified in the strict Zod schemas beside their routes.

All business calls require an active session. Every mutation requires an `Origin` exactly matching `WEB_ORIGIN`. Financial creation, allocation and approval require an `Idempotency-Key` of 8–120 characters. Identical retries return saved results; changed input under the same key returns 409. Money values are **decimal strings**. Roles and customer scope always come from the server session.

| Area | Routes / policy |
|---|---|
| Identity | `/me`; native Better Auth sign-up/email, sign-in/email, verification, reset/change password, sessions and TOTP |
| Staff | Admin `/staff`, `/staff/invite` `{email,role}`, `PATCH /staff/:id` `{role?,suspended?}` with fresh session; verified recipient `/me/accept-invite` `{token}` |
| Customers | `/customers`, `/:id`, `/:id/contacts`, `/:id/notes`, `/customers/import` `{csv}`, `/customers/export`; create admin/sales, profile edit admin/sales/owner, notes support permitted |
| Catalog | `/products`, `/:id`, `/:id/variants`, `/:id/addons`, `/plans`, `/:id/versions`; writes admin only |
| Policies | `/taxes`, `/discounts`, `/quote-templates`; configuration admin only |
| Quotes | `/quotes`, `/:id`, `/:id/send`, `/:id/revise`; create/send/revise admin/sales; accept/reject customer owner or admin; `/:id/pdf` ownership enforced |
| Subscriptions | `/subscriptions`, `/:id`, `/:id/preview`, `/:id/entitlements`; `/:id/action` `{action:activate|pause|resume|renew|cancel|close,endAt?}`; activation/close internal; `/:id/change` `{planVersionId,quantity}` schedules next-boundary compatible terms |
| Billing | `/billing/run` `{subscriptionId?}` queues due jobs; `/billing/jobs` and `/:id/retry`; admin/finance |
| Invoices | `/invoices`, `/:id`, `/:id/pdf`, `/:id/confirm`, `/:id/cancel` `{reason}`; financial writes admin/finance, read/PDF customer scoped |
| Payments | `/payments`; create admin/finance; `/:id/allocate` `{invoiceId,amount}`; reference unique, allocations append-only |
| Adjustments | `/credits`; `/adjustments` `{customerId,paymentId?,kind,amount,currency,reason}`; admin/finance/support request; **different** admin/finance approves `/:id/decide` `{approve,expiresAt?}` |
| Usage | `/usage`, `/usage/meters`; ingestion admin; `{eventId,subscriptionId,meterId,quantity,occurredAt}` with stable deduplicated IDs |
| Reports | `/reports/dashboard`, `/reports/export` (admin/finance), `/reports/revenue-schedule` (admin/finance) |
| Integrity | `/integrity`, `/integrity/scan` `{cursor?}`, `/:id/review` `{action,reason,adjustmentId?}`; `/:id/request-correction` `{reason}` creates an independently reviewed draft correction; admin/finance |
| Operations | `/notifications`, `/notifications/:id/retry` (admin), `/audit` (admin/finance), `/settings` (admin) |

Lists accept applicable `page`, `limit` (1–100), `search`, `status`, `customerId`, `productId`, `planId`. Reports additionally accept UTC `from`/`to` and one currency. Errors return a safe message and request ID: 400 input/state; 401 session; 403 role/MFA/origin; 404 absent or outside ownership; 409 conflict.

## Metrics and rounding

- Invoiced = confirmed totals by issue date; cash = receipts by received date. These are separate from recognized revenue.
- Outstanding = issued total minus allocations, bounded at zero. Overdue requires positive outstanding and a past due instant.
- MRR = current active recurring contract charges before tax/discount/setup/credits/usage, normalized monthly (annual ÷12, weekly ×52÷12, daily ×365÷12). ARR = MRR×12; ARPA = MRR÷active customers.
- Discounts apply before tax, capped at eligible value. Invoice discounts use largest-remainder allocation of cents; components use half-up rounding. Tax-inclusive prices back out net value and assign residual tax cents deterministically.
- Credits cannot make an invoice negative. Financial documents use two decimal places; prices/meters can use six. Payments reject fractional cents rather than silently rounding them.
