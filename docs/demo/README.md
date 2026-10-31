# Demonstration guide

Follow the root README setup and seed instructions. All records below live in PostgreSQL. Credentials are generated locally into ignored `.local/demo-credentials.json`; never put them in a presentation or PR.

## Main journey

1. Admin: sign in with the current generated TOTP (`npm run demo:otp -- admin`). Create a product in Product catalog and open it to add variants/add-ons. The seeded Odoo edition has a configurable 560 increment.
2. Create a monthly plan, choose a tax rule and a unit price. Daily, weekly and yearly intervals are also available.
3. Customer: register, then open the verification link in `.local/mail`. The worker must be running to deliver local messages.
4. Sales: create a quotation for that customer from a template, choose plan/quantity/edition/add-ons, then send it.
5. Customer: open the quotation, review terms/PDF and accept. It creates a CONFIRMED agreement; existing quote terms cannot be edited.
6. Sales/admin: open the converted subscription and activate it. Billing operations can enqueue the due work; the separate worker generates a draft invoice.
7. Finance: review the invoice and Explain This Bill, download the PDF and confirm it. Record a partial bank payment with a unique reference, selecting that invoice. Its accounting status remains CONFIRMED while payment state becomes PARTIALLY PAID.
8. Record the remaining amount with a different reference. Payment state becomes PAID and dashboard cash/outstanding metrics update from database aggregates.
9. Customer: review the same invoice, payment history and next invoice estimate. Pause after due billing, resume, renew or schedule a compatible next-period plan/quantity change.

## Reliability and correction demonstration

- Queue the same due period twice; the job key, locks and database uniqueness prevent duplicate invoices. The integration suite also runs two billing transactions concurrently.
- Seeded subscriptions include active, paused, closed and missing-period records; invoices include full, partial and overdue balances.
- The expired EXPIRED20 discount never applies; WELCOME10 has validity and a global usage limit.
- Open ProofBill and run verification. Seeded altered **draft** totals produce under/overbilling findings. Some early-development local records may need a fresh seed after code changes; a fresh checkout always uses the final snapshot hashing.
- Choose Request correction for an intact discrepant draft and provide a reason. Finance can request it; a different administrator/finance user approves it in Credits & refunds. The draft is restored from its verified calculation; audits keep both values. Resolve the corrected finding, then confirm the invoice.
- A manual credit/prepaid grant also needs an independent approver. The next generated invoice consumes available credits transactionally.
- Seeded AI API contracts use hybrid base-plus-usage pricing. Admin records a unique usage event; the next eligible invoice bills received unbilled consumption in arrears above its allowance.

No external payment gateway or actual refund transfer is demonstrated. Notification delivery is a local development mailbox, not verified external SMTP. See [limitations](../known-limitations.md).
