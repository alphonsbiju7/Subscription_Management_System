# Integration boundary

Local demonstration requires no paid account. Payments are recorded by authorized finance users; no card/CVV data is stored. Email is queued transactionally and delivered by the separate worker, using development files or configured production SMTP.

Stripe and Razorpay integrations are **deferred**, not dummy implementations. To enable one in a future change:

1. Add a provider adapter with sandbox credentials loaded only server-side.
2. Persist payment attempts/provider session IDs and link them to customer, invoice, currency and the outstanding balance.
3. Initiate hosted checkout from the server; never accept a frontend success flag as payment evidence.
4. Verify raw-body webhook signatures and timestamp tolerance before parsing/processing. Store unique provider event IDs, durable processing state and idempotent financial keys.
5. Match trusted provider amount/currency/customer to the persisted attempt. Handle concurrent manual payments by recording excess funds as unapplied cash, without overallocating.
6. Retry processing durably; support reconciliation and independently approved refunds without double movement.
7. Test bad signatures, stale/replayed events, duplicate events, provider outages, partial payments and refund synchronization before enabling a customer payment control.

Outbound webhooks likewise need signed payloads, egress/SSRF protection, retry/dead-letter records and delivery logs. No outbound URL execution is accepted by the present API.

For SMTP, configure `SMTP_HOST`, `SMTP_PORT`, sender and optional username/password. `SMTP_SECURE=true` means implicit TLS; STARTTLS behavior and certificates must be validated with the chosen provider. The transport disables URL/file content access. Real external delivery was not tested.
