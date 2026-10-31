# CODEX MASTER IMPLEMENTATION PROMPT
## Brightloop SubscriptionOS — Enterprise-Grade Subscription Management, Billing Automation & Revenue Intelligence Platform

### YOUR ROLE

Act as an elite multidisciplinary software engineering team consisting of:

- Principal Software Architect
- Senior Full-Stack Developer
- React/TypeScript Frontend Engineer
- Node.js Backend Engineer
- PostgreSQL Database Architect
- Subscription Billing and Financial Systems Engineer
- Application Security Engineer
- DevSecOps Engineer
- UI/UX Designer
- Automated Testing and Quality Assurance Engineer
- Performance and Reliability Engineer
- Technical Documentation Engineer

Your task is to design, build, integrate, secure, test, and document a fully functional, production-oriented web application for managing the complete subscription lifecycle of Brightloop Software.

Do not merely design screens or prepare an architectural proposal. **Implement the working application in the repository.**

Every implemented interface must be connected to real business logic, APIs, and persistent database records.

The application must run locally, including its essential billing workflows, without requiring paid external services.

Do not claim that a feature is complete unless its functional behavior has been implemented and tested.

---

# SECTION 1 — PROJECT CONTEXT AND OBJECTIVE

## 1.1 Project name

**Brightloop SubscriptionOS**

Subtitle:

**Unified Subscription Management, Automated Billing, Payment Operations & Revenue Intelligence**

## 1.2 Business scenario

Brightloop Software is a fictional software company that sells subscription-based products.

Its customers include small businesses purchasing monthly subscriptions and enterprises purchasing annual contracts.

Products may have different variants, optional add-ons, different subscription plans, quantity-based pricing, discounts, taxes, and billing arrangements.

Currently, Brightloop faces these problems:

1. Subscription information is maintained in spreadsheets.
2. Renewals are tracked manually.
3. Invoices are manually prepared.
4. Payments are manually reconciled against bank statements.
5. Business revenue reports take too long to generate.
6. Invoices may be duplicated, skipped, or calculated incorrectly.
7. Customers cannot independently manage their subscription information.
8. Internal operations are fragmented across several processes.

Build a single integrated software platform that solves all these problems.

## 1.3 Precise project scope

We have selected **Option 1: Build a management system for Brightloop Software**.

This is NOT:

- A recreation of the software products Brightloop sells.
- An independent subscription marketplace.
- A platform holding customer funds as a financial intermediary.
- A merchant-of-record service.
- A replacement for banking and payment networks.

The system belongs to Brightloop and is used by its administrators, employees, finance personnel, and customers.

All primary workflows must support this single-company business model.

Use architecture that could eventually support multiple independent businesses, but do not introduce a marketplace or multi-company onboarding into the primary user experience.

## 1.4 Main business workflow

Implement the complete interconnected lifecycle:

Customer registration
→ Product and variant configuration
→ Pricing plan creation
→ Quotation template
→ Customer quotation
→ Quotation acceptance
→ Subscription confirmation
→ Subscription activation
→ Scheduled recurring billing
→ Invoice generation
→ Invoice confirmation and delivery
→ Payment recording or gateway confirmation
→ Payment reconciliation
→ Subscription renewal
→ Financial reporting and analytics.

Every stage must be connected.

A change in one relevant business object must correctly affect downstream operations according to defined business rules.

---

# SECTION 2 — TECHNOLOGY STACK

Use the following stack consistently unless a documented compatibility or security problem makes a substitution necessary.

## Frontend

- React
- TypeScript with strict mode
- Vite
- Tailwind CSS
- Accessible and maintained UI components
- React Router
- TanStack Query for server-state management
- React Hook Form with Zod validation
- Recharts for financial dashboards
- Lucide icons
- Responsive layouts suitable for desktop, tablet, and mobile browsers

## Backend

- Node.js 22+ or a compatible maintained LTS release
- TypeScript with strict compiler settings
- Express
- Zod for request and response schema validation
- Modular service and repository architecture
- OpenAPI documentation
- Structured application logging

## Database

- PostgreSQL
- Prisma ORM
- Prisma migrations
- Database-native DECIMAL/NUMERIC types
- Decimal.js for financial computations
- Database transactions and integrity constraints
- Proper foreign keys, indexes, and uniqueness constraints

## Authentication and authorization

- Better Auth, if its current maintained APIs fit the architecture
- Argon2id for password hashing
- Secure server-managed sessions
- HttpOnly, Secure, appropriately scoped SameSite cookies
- Fine-grained role and permission enforcement
- MFA for privileged accounts
- CSRF protection

Do not invent authentication library APIs. Inspect the installed library documentation before implementing them.

## Scheduled processing

- Dedicated Node.js worker
- PostgreSQL-backed durable job processing
- Graphile Worker if technically compatible and advantageous
- Transactional outbox for important domain events
- Retries, dead-letter handling, and job execution history

## Supporting infrastructure

- SMTP for email
- PDF generation for invoices and quotations
- Docker Compose
- Git and GitHub
- Vitest
- Supertest or equivalent API testing
- Playwright browser testing
- Dependency vulnerability scanning
- Secrets and environment validation

Use one modular monolith with a separate billing worker.

Avoid unnecessary microservices, Kubernetes, Kafka, or unrelated infrastructure.

---

# SECTION 3 — PROJECT STRUCTURE

Use a maintainable structure similar to:

```text
brightloop-subscription-os/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── shared-types/
│   ├── validation/
│   ├── billing-engine/
│   └── ui/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   ├── e2e/
│   └── performance/
├── docs/
│   ├── architecture/
│   ├── requirements/
│   ├── security/
│   ├── api/
│   ├── testing/
│   └── demo/
├── scripts/
├── docker-compose.yml
├── .env.example
├── README.md
└── package.json
```

The backend must contain logically separated modules for authentication, authorization, users, customers, products, variants, plans, quotations, subscriptions, pricing, taxes, discounts, invoices, payments, credits, reporting, notifications, audit trails, and billing verification.

Avoid circular dependencies and duplicated business logic.

---

# SECTION 4 — USER ROLES AND DASHBOARDS

Implement secure role-based interfaces.

## 4.1 Administrator

The admin must be able to:

- View an organization-wide dashboard.
- Create, update, archive, and manage products.
- Configure product variants and add-ons.
- Create pricing plans.
- Configure billing intervals and rules.
- Manage quotation templates.
- Configure taxes.
- Create and manage discount rules.
- Invite, activate, suspend, and remove internal staff access.
- Assign staff permissions.
- View all permitted customer and subscription records.
- Review and approve sensitive financial corrections.
- Configure email notifications and integrations.
- Review security activity.
- View audit logs.
- Manage relevant application settings.
- View financial and operational reports.

**Only authorized administrators may create or invite staff accounts.**

## 4.2 Sales staff

Implement a sales workspace containing:

- Customer search and creation.
- Customer profiles.
- Lead and quotation workflow as needed for the required sales process.
- Quotation template selection.
- Quotation creation.
- Pricing and discount previews.
- Quotation validity tracking.
- Quotation acceptance and conversion.
- Subscription creation and activation, subject to authorization.
- Renewal opportunities.
- Customer history.

Sales employees must not be able to modify global security or financial settings.

## 4.3 Finance staff

Implement a finance workspace containing:

- Invoice review.
- Invoice confirmation and delivery.
- Payment recording.
- Partial payment handling.
- Payment-to-invoice allocation.
- Outstanding invoice monitoring.
- Accounts receivable aging.
- Credits and refunds.
- Billing discrepancies.
- Financial correction approval workflow.
- Revenue reporting.
- Tax reporting.
- Downloadable reports.
- Financial audit history.

## 4.4 Support staff

Implement limited customer-service functions:

- Search permitted customers.
- Review customer subscriptions.
- View invoice and payment status as permitted.
- Help with renewal requests.
- View customer billing history.
- Record customer support notes.
- Escalate financial corrections.

Support employees must not be able to silently modify confirmed financial records.

## 4.5 Customer portal

Customers must be able to:

- Register and log in.
- Manage their profile.
- View available subscription products and plans.
- Review quotes addressed to them.
- Accept or reject eligible quotations.
- View active, paused, expiring, and closed subscriptions.
- View billing dates.
- View plan features and usage entitlements.
- View current and historical invoices.
- Download invoice PDFs.
- Review payment history.
- Pay outstanding invoices through an enabled gateway integration.
- Request eligible upgrades or downgrades.
- Pause, resume, renew, or cancel subscriptions when permitted by the applicable plan.
- View applicable credits.
- View projected next-invoice amounts.
- Receive notifications and reminders.

Customers must never access another customer's information.

Support role-based menus, but enforce every restriction in the backend and database-access layer, not merely in the UI.

---

# SECTION 5 — AUTHENTICATION AND ACCOUNT SECURITY

Implement real authentication and account management.

Required features:

1. Customer registration.
2. Unique email enforcement.
3. Email normalization and verification.
4. Secure login and logout.
5. Password reset through a single-use, short-lived email token.
6. Password-change functionality.
7. Session invalidation after relevant security events.
8. Active-session management.
9. Staff invitation through administrator authorization.
10. User account suspension and reactivation.
11. Login rate limiting.
12. Account recovery protections.
13. MFA for admin and finance accounts.
14. TOTP or passkey support where practical.
15. Security event logging.

The original problem statement specifies passwords longer than eight characters and containing uppercase, lowercase, and special characters.

Implement a clearly documented PDF-compliance password policy that satisfies these exact conditions, while also:

- Allowing long passwords and passphrases.
- Rejecting common and compromised passwords where a suitable checker is available.
- Using Argon2id.
- Preventing credential enumeration.
- Supporting a stronger production password policy.
- Avoiding arbitrary periodic password expiry.

Do not store passwords or reset tokens in plaintext.

---

# SECTION 6 — CUSTOMER MANAGEMENT

Implement complete customer records.

Fields should include:

- Unique customer ID
- Customer or business name
- Email
- Contact information
- Billing address
- Shipping or service address where relevant
- Company name
- Tax registration information
- Currency
- Payment terms
- Customer status
- Notes
- Creation and modification timestamps

Functionalities:

- Create customers.
- Search customers.
- Filter and paginate customer records.
- Update customer profiles.
- Deactivate customers without destroying financial history.
- View subscription history.
- View invoices.
- View payment history.
- View outstanding balances.
- View customer-specific pricing agreements.
- Store associated contact persons.
- Maintain relevant billing history.
- Export customer records.
- Import records through validated CSV files.
- Detect duplicate customer entries.

Use strict record-level authorization.

---

# SECTION 7 — PRODUCT, VARIANT, AND SERVICE MANAGEMENT

Implement a complete product catalog.

## 7.1 Product attributes

Each product must support:

- Product identifier
- Name
- Type
- Description
- Sales price
- Cost price
- Currency
- Status
- Notes
- Tax category
- Product category
- Optional features
- Add-ons

## 7.2 Product variants

Support:

- Brand variations.
- Different software editions.
- Different feature packages.
- Price adjustments.
- Variant-specific availability.
- Variant-specific identifiers.

The PDF specifically provides an example in which choosing the Odoo brand adds 560 to the price.

Implement this scenario as configurable seed data with the price adjustment preserved.

## 7.3 Product operations

Implement:

- Create.
- Read.
- Update.
- Archive.
- Search.
- Filter.
- Compare variants.
- Manage add-ons.
- Configure product tax associations.
- Configure price lists.
- Preserve relevant historical prices.
- Prevent destructive deletion of products referenced by financial records.

---

# SECTION 8 — SUBSCRIPTION PLAN MANAGEMENT

Implement a flexible subscription plan engine.

Every plan must support:

- Unique plan ID
- Plan name
- Associated product
- Plan description
- Currency
- Price
- Billing frequency
- Minimum quantity
- Start of availability
- End of availability
- Auto-close policy
- Early closure policy
- Pause policy
- Renewal policy
- Plan status

## Billing frequencies

Implement all four mandatory intervals:

- Daily
- Weekly
- Monthly
- Yearly

Also provide configurable billing alignment where practical.

## Additional pricing models

Implement the following features derived from researched billing products:

1. Flat-rate pricing.
2. Per-seat pricing.
3. Quantity-based pricing.
4. Tiered pricing.
5. Volume pricing.
6. Package pricing.
7. Usage-based pricing.
8. Hybrid fixed-plus-usage pricing.
9. One-time setup charges.
10. Optional add-on charges.
11. Customer-specific negotiated pricing.
12. Trial periods.
13. Introductory pricing.
14. Subscription price phases.
15. Future-dated plan changes.
16. Scheduled upgrades.
17. Scheduled downgrades.
18. Contract-specific overrides.
19. Prepaid credits.
20. Credit grants.
21. Usage entitlements.
22. Usage limits.
23. Plan version history.

Keep the required fixed recurring-plan workflow simple and fully functional even when advanced pricing features are enabled.

Never calculate past invoices using prices that became effective only in a later period.

---

# SECTION 9 — QUOTATION AND SALES WORKFLOW

Implement quotation management based on ERPNext, Odoo, Chargebee, and Zoho Billing workflow concepts.

## Features

- Quotation templates.
- Customer-linked quotations.
- Multiple product lines.
- Variant selection.
- Quantity selection.
- Unit prices.
- Taxes.
- Discounts.
- Add-ons.
- Payment terms.
- Currency.
- Quotation validity start and end.
- Expiration checks.
- Draft quotations.
- Sent quotations.
- Accepted quotations.
- Rejected quotations.
- Expired quotations.
- Quotation revisions.
- Quotation PDF generation.
- Email delivery.
- Authorized quotation approval.
- Customer acceptance workflow.
- Conversion into subscriptions.

Accepted quotations must preserve the agreed terms.

A quotation cannot be silently changed after acceptance.

Any modification to an accepted offer must create an appropriately versioned revision or new agreement.

Implement a working end-to-end:

Quotation → Accepted agreement → Subscription → Invoice.

---

# SECTION 10 — SUBSCRIPTION LIFECYCLE ENGINE

Implement the exact main state progression required in the PDF:

**Draft → Quotation → Confirmed → Active → Closed**

Support additional controlled substates for:

- Paused
- Pending activation
- Expiring
- Past due
- Cancelled
- Trialing
- Renewal pending

These additional states must be modeled consistently without breaking the mandatory lifecycle.

Every subscription must store:

- Subscription number
- Customer ID
- Associated quotation or agreement
- Selected plan
- Product and variant
- Subscription lines
- Quantity
- Unit price
- Discount rules
- Tax rules
- Start date
- Expiry date
- Next billing date
- Payment terms
- Current status
- Renewal configuration
- Historical changes

## Operations

Implement:

- Create subscription.
- Confirm subscription.
- Activate subscription.
- Pause.
- Resume.
- Renew.
- Cancel.
- Close.
- Upgrade.
- Downgrade.
- Change quantities.
- Add or remove add-ons.
- Change future billing plans.
- Handle scheduled expiration.
- Handle subscription trials.
- Handle payment failures.
- Handle permitted reactivation.
- Preserve historical contract versions.
- Record status transition audit events.

## Proration

For supported mid-cycle changes, calculate prorated charges or credits using explicitly defined policies.

For every prorated calculation, show:

- Previous charge.
- Unused period credit.
- New plan charge.
- Remaining billable period.
- Final adjustment.

Write unit tests for all date-boundary and proration scenarios.

---

# SECTION 11 — TAX AND DISCOUNT ENGINE

## 11.1 Tax management

Only authorized administrators can configure tax rules.

Support:

- Percentage-based taxes.
- Multiple tax components.
- Tax-inclusive pricing.
- Tax-exclusive pricing.
- Product-specific taxes.
- Customer-specific tax treatments.
- Tax validity periods.
- Tax-exempt configurations.
- Tax calculation snapshots.
- Jurisdiction-aware tax configuration.
- Invoice tax breakdowns.
- Tax summaries and exports.

For an India-oriented demonstration, support configurable GST-related invoice fields and illustrative CGST/SGST/IGST scenarios where applicable.

Do not claim legal GST compliance without verifying jurisdiction-specific rules.

## 11.2 Discount management

Support:

- Fixed-amount discounts.
- Percentage discounts.
- Minimum purchase values.
- Minimum quantities.
- Effective start dates.
- Effective end dates.
- Usage limits.
- Product-specific discounts.
- Subscription-wide discounts.
- Customer-specific discounts.
- Promotional coupons.
- Contractual discounts.
- Discount eligibility validation.
- Discount usage history.
- Automatic expiration.
- Discount stacking policies.
- Discount previews.

Only authorized administrators can create or change discount policies.

Use database transactions to prevent concurrent operations from exceeding discount usage limits.

Expired or exhausted discounts must not be applied.

Define the order of discounts, taxes, and invoice adjustments clearly and consistently.

---

# SECTION 12 — RECURRING BILLING ENGINE

**This is one of the most critical modules in the entire system.**

Implement real recurring billing, not a simulated timer or frontend-only billing action.

## Required behavior

The billing worker must:

1. Identify subscriptions eligible for billing.
2. Detect due billing periods.
3. Validate subscription status.
4. Apply the effective plan version.
5. Calculate quantities and unit prices.
6. Calculate eligible add-ons.
7. Calculate applicable usage charges.
8. Apply valid discounts.
9. Apply tax rules.
10. Apply available credits according to policy.
11. Create invoice records.
12. Create invoice line items.
13. Record the billing period.
14. Schedule the next billing occurrence.
15. Queue invoice notifications.
16. Save execution history.
17. Retry safely after recoverable failures.

## Financial correctness requirements

Use exact decimal calculations.

Use database DECIMAL/NUMERIC fields for monetary amounts.

Never use ordinary JavaScript floating-point arithmetic as the source of truth for money.

Every financial operation must follow documented rounding rules.

## Idempotency

The same billing operation must not generate duplicate invoices even if:

- A job runs twice.
- A worker crashes.
- A process restarts.
- Two workers execute simultaneously.
- An API request is retried.
- A network timeout occurs.

Enforce database uniqueness on the relevant subscription and billing-period identity.

Use transactional billing operations and durable idempotency keys.

## Missed billing recovery

If a billing worker is offline during a scheduled invoice period, it must identify and process eligible missed occurrences after recovery.

Do not advance the billing cursor past unprocessed periods.

Implement bounded catch-up processing and operational monitoring.

## Date handling

Correctly handle:

- End-of-month billing.
- February.
- Leap years.
- Monthly billing starting on the 29th, 30th, or 31st.
- Yearly billing.
- Timezone conversion.
- Daylight-saving transitions where applicable.
- Inclusive/exclusive billing-period boundaries.
- Subscription expiry.
- Trial conversion.
- Delayed activation.
- Pause and resume.

Store timestamps in UTC and apply an explicit business timezone for billing schedules.

The demo business timezone may default to Asia/Kolkata.

---

# SECTION 13 — INVOICE MANAGEMENT

Implement a full invoice module.

## Invoice states

Support at least:

- Draft
- Confirmed
- Paid

Also support cancellation, partial payment, overdue status, and appropriate correction workflows.

Do not confuse the accounting status of an invoice with the payment status.

## Invoice information

Include:

- Unique invoice number
- Customer details
- Subscription reference
- Billing period
- Invoice date
- Due date
- Currency
- Product lines
- Quantities
- Unit prices
- Discounts
- Taxes
- Credits
- Subtotal
- Total
- Amount paid
- Outstanding amount
- Payment terms

## Invoice operations

Implement:

- Create draft invoices.
- Review invoices.
- Confirm invoices.
- Send invoice emails.
- Generate professional PDF invoices.
- Print invoices.
- Download invoices.
- Search and filter invoices.
- View invoice history.
- Record payment allocations.
- Mark fully paid invoices.
- Identify overdue invoices.
- Cancel eligible invoices.
- Create credit notes for issued-invoice adjustments.
- Apply credits and refunds.
- Consolidate eligible charges when configured.
- Preview invoice calculations.
- Preserve billing snapshots.

Confirmed financial documents must not be silently overwritten.

Use versioned corrections and credit notes where appropriate.

---

# SECTION 14 — PAYMENT MANAGEMENT AND RECONCILIATION

Implement payment management even without a live payment gateway.

## Manual payment handling

Authorized finance staff must be able to record:

- Payment ID
- Invoice reference
- Customer
- Amount
- Currency
- Payment method
- Payment date
- Transaction reference
- Notes
- Recorded-by user
- Payment status

## Supported operations

- Record payments.
- Record partial payments.
- Allocate one payment across eligible invoices.
- Allocate multiple payments to one invoice.
- Reject duplicate payment references according to appropriate constraints.
- Display outstanding balances.
- Calculate overdue amounts.
- Track unapplied payments.
- Create refunds.
- Record payment adjustments.
- Reconcile financial records.
- Export payment history.
- Track reconciliation discrepancies.

## Gateway integration

Implement a provider abstraction supporting optional:

- Stripe test mode.
- Razorpay test mode.

Do not require either provider for the local demonstration.

When enabled, support:

- Hosted checkout or provider-approved payment flow.
- Subscription and invoice payment initiation.
- Payment success and failure handling.
- Verified webhook signatures.
- Webhook replay protection.
- Unique provider event IDs.
- Idempotent event processing.
- Payment-to-invoice matching.
- Payment retries.
- Refund synchronization.
- Gateway outage handling.

**Never mark an invoice as paid merely because the frontend reports payment success.**

Confirm payment through trusted server-side records or a verified payment provider event.

Do not store card numbers, CVVs, or sensitive payment credentials in the application database.

---

# SECTION 15 — CREDITS, REFUNDS, AND PREPAID BALANCES

Implement a financial adjustment module inspired by established billing platforms.

Support:

- Credit notes.
- Customer credit balances.
- Prepaid credits.
- Credit grants.
- Credit expiration policies.
- Usage credit consumption.
- Subscription cancellation credits.
- Proration credits.
- Refund requests.
- Refund approvals.
- Payment refund records.
- Credit application to invoices.
- Adjustment audit history.

All credit and refund operations must use transactional, append-only accounting-style records.

Sensitive adjustments should support maker-checker approval.

For example, an employee may request a ₹5,000 refund, while a separate authorized user approves it.

Prevent double refunds and negative balances unless explicitly permitted by the financial rules.

---

# SECTION 16 — USAGE-BASED BILLING AND ENTITLEMENTS

Implement the advanced capabilities inspired by Lago, OpenMeter, Stripe Billing, Chargebee, and Zuora.

## Usage metering

Support:

- Meter definitions.
- Usage events.
- Unique event IDs.
- Customer and subscription attribution.
- Event timestamps.
- Quantity aggregation.
- Usage-period aggregation.
- Duplicate event rejection.
- Late-arriving usage events.
- Configurable billing cutoffs.
- Usage correction procedures.
- Per-unit pricing.
- Tiered usage pricing.
- Package pricing.
- Hybrid subscription-and-usage charging.

For demonstration, create a fictional AI API product that charges a base monthly subscription plus usage.

## Entitlements

Support:

- Included seats.
- Included API calls.
- Included storage or usage allowances.
- Feature permissions linked to plans.
- Consumption limits.
- Usage summaries.
- Credit allowances.
- Plan-based access decisions.

The usage module must be integrated into the actual invoice-generation process.

Do not produce fake usage charts based only on static frontend JSON.

---

# SECTION 17 — AUTOMATED RENEWALS, REMINDERS, AND DUNNING

Implement a notification and collections automation system.

Support:

- Upcoming renewal reminders.
- Upcoming invoice reminders.
- Invoice delivery confirmation.
- Due-date reminders.
- Overdue payment notifications.
- Failed-payment notifications.
- Payment receipt notifications.
- Subscription expiry reminders.
- Cancellation notifications.
- Trial-ending reminders.
- Admin-configurable reminder schedules.
- Email templates.
- Notification history.
- Retryable email delivery.
- Notification preferences.
- Outbox records.

## Dunning workflows

Support configurable collection sequences.

Example:

- Invoice becomes overdue.
- First reminder is queued.
- Second reminder follows after the configured interval.
- Finance staff receive an escalation notification.
- The subscription may become past due or suspended according to policy.

Avoid automatically cancelling subscriptions without considering the configured grace period and contract terms.

Notification failures must not corrupt the financial transaction.

---

# SECTION 18 — FINANCIAL REPORTING AND REVENUE INTELLIGENCE

Create an accurate, real-time financial reporting module.

## Required PDF metrics

- Active subscriptions.
- Revenue information.
- Payments collected.
- Outstanding amounts.
- Overdue invoices.
- Invoice totals.
- Subscription status summaries.

## Advanced SaaS metrics

Implement:

- Monthly Recurring Revenue (MRR).
- Annual Recurring Revenue (ARR).
- New MRR.
- Expansion MRR.
- Contraction MRR.
- Churned MRR.
- Net MRR change.
- Customer churn.
- Revenue churn.
- Customer retention.
- Net Revenue Retention.
- Gross Revenue Retention.
- Average Revenue per Account.
- Customer Lifetime Value estimate where underlying assumptions are available.
- Recurring versus one-time revenue.
- Revenue by product.
- Revenue by plan.
- Revenue by customer segment.
- Revenue by billing frequency.
- Payment success rate.
- Failed payment rate.
- Payment recovery rate.
- Overdue invoice aging.
- Outstanding receivables.
- Collections trend.
- Discount impact.
- Credit and refund impact.
- Usage-based revenue.
- Plan upgrade and downgrade trends.

Clearly label metrics and document formulas.

Do not treat invoiced amounts, cash collected, and accounting revenue as interchangeable.

## Revenue recognition

Provide a separate basic contract revenue schedule module when enough data exists.

Support:

- Service periods.
- Deferred revenue estimates.
- Recognized revenue schedules.
- Contract revenue allocation assumptions.
- Adjustments caused by cancellation or refunds.
- Explanations of the applied recognition rule.

Do not claim formal GAAP, IFRS, or tax compliance without independently verified rules and tests.

## Dashboard functionality

All dashboards must support:

- Date filters.
- Customer filters.
- Plan filters.
- Product filters.
- Status filters.
- Search.
- Drill-down.
- Paginated tables.
- Charts.
- CSV exports.
- PDF reports where appropriate.
- Consistent loading and empty states.
- Meaningful error messages.

Do not calculate large financial totals using only the rows currently visible in frontend pagination.

---

# SECTION 19 — PROOFBILL: BILLING INTEGRITY AND VERIFICATION

Implement ProofBill as a built-in verification module within Brightloop SubscriptionOS.

It must operate on actual subscription agreements, billing periods, invoice data, discount rules, tax configuration, and payment records.

## Detection rules

Implement:

1. Missing invoice detection.
2. Duplicate invoice detection.
3. Underbilling detection.
4. Overbilling detection.
5. Incorrect quantity detection.
6. Invalid price detection.
7. Expired discount application.
8. Discount usage-limit violations.
9. Incorrect tax application.
10. Unauthorized billing-period changes.
11. Invoices generated after disallowed subscription closure.
12. Unreconciled payment detection.
13. Duplicate payment detection.
14. Unexpected invoice adjustments.
15. Misapplied credits.
16. Renewal-related billing inconsistencies.

## Explain This Bill

Create an invoice explanation interface showing:

- Contracted plan.
- Effective plan version.
- Quantity.
- Unit price.
- Billing period.
- Add-ons.
- Usage charges.
- Applicable discounts.
- Tax calculation.
- Credits.
- Final expected total.
- Actual invoice total.
- Source records.
- Calculation steps.

## Preview Next Invoice

Show a deterministic next-invoice estimate with:

- Next billing date.
- Scheduled plan and quantity.
- Expected charges.
- Applicable discounts.
- Expected tax.
- Existing credits.
- Estimated total.
- Explicit uncertainty when usage-dependent amounts are unknown.

## Financial discrepancy workflow

Implement:

Detected
→ Under review
→ Approved correction or dismissed with reason
→ Corrected
→ Resolved.

Maintain evidence and audit logs.

Never silently mutate issued financial records.

## AI functionality

AI may optionally generate plain-language explanations from structured verified billing records.

All calculations and financial decisions must remain deterministic.

The application must remain fully functional without an AI API key.

AI must not invent prices, approve refunds, change permissions, or execute financial transactions.

---

# SECTION 20 — UI AND UX DESIGN

Develop a modern, professional enterprise SaaS interface.

The design should reflect the usability expectations of mature billing platforms without copying proprietary assets.

## Visual requirements

- Clean typography.
- Consistent spacing.
- Restrained colors.
- Professional dashboard layout.
- Responsive navigation.
- Sidebar for administrative workspaces.
- Clear data hierarchy.
- Accessible form fields.
- Readable financial tables.
- Functional charts.
- Helpful empty states.
- Loading skeletons.
- Explicit error states.
- Confirmation dialogs for sensitive actions.
- Accessible keyboard navigation.
- Focus indicators.
- Appropriate color contrast.
- Clear currency and date formatting.

## Required pages

Implement at least:

1. Login.
2. Registration.
3. Password reset.
4. Administrator dashboard.
5. Staff management.
6. Customer management.
7. Product catalog.
8. Product variants.
9. Plan management.
10. Pricing configuration.
11. Quotation templates.
12. Quotations.
13. Subscription list.
14. Subscription detail.
15. Subscription lifecycle history.
16. Billing operations.
17. Invoice list.
18. Invoice detail.
19. Invoice PDF preview.
20. Payment management.
21. Outstanding invoices.
22. Discounts.
23. Tax configuration.
24. Credit and refund management.
25. Usage metering.
26. Entitlements.
27. Notifications.
28. Finance dashboard.
29. Reporting.
30. Billing integrity dashboard.
31. Audit and security logs.
32. Settings and integrations.
33. Customer portal home.
34. Customer subscription details.
35. Customer invoices.
36. Customer payment history.
37. Customer profile.
38. Customer renewal and plan-change interface.

Related screens can be consolidated if doing so improves usability, but no underlying functionality may be silently omitted.

Every button, filter, form, and navigation item must perform its advertised function.

Do not create decorative or permanently disabled controls and present them as implemented capabilities.

---

# SECTION 21 — API AND INTEGRATION ARCHITECTURE

Develop typed and validated REST APIs.

Organize APIs around domain responsibilities:

- Authentication.
- Users.
- Roles.
- Customers.
- Products.
- Variants.
- Plans.
- Pricing.
- Quotations.
- Subscriptions.
- Invoices.
- Payments.
- Discounts.
- Taxes.
- Credits.
- Usage.
- Entitlements.
- Reports.
- Notifications.
- Audit records.
- Integrations.
- Billing verification.

## API requirements

- Consistent versioned routes.
- Request validation.
- Response schema validation for sensitive endpoints.
- Pagination.
- Sorting.
- Filtering.
- Safe error responses.
- Authentication.
- Authorization.
- Record-level access checks.
- Idempotency for financial mutations.
- Transaction isolation.
- OpenAPI documentation.
- Structured logs.
- Rate limiting.

## Webhooks

Implement durable inbound and outbound webhook handling.

Support:

- Signed webhook verification.
- Event timestamps.
- Replay protection.
- Deduplication.
- Retry policies.
- Event status tracking.
- Delivery logs.
- Backoff.
- Dead-letter handling.
- Safe reprocessing.

External integration failures must not corrupt internal subscriptions or invoice records.

---

# SECTION 22 — DATABASE DESIGN

Create a normalized, migration-managed PostgreSQL schema.

At minimum, model entities for:

- Organizations/configuration
- Users
- Roles
- Permissions
- Sessions
- MFA credentials
- Customer profiles
- Customer contacts
- Customer addresses
- Products
- Product variants
- Add-ons
- Price lists
- Subscription plans
- Plan versions
- Plan phases
- Plan entitlements
- Quotation templates
- Quotations
- Quotation lines
- Quotation revisions
- Subscriptions
- Subscription items
- Subscription events
- Subscription amendments
- Billing periods
- Billing jobs
- Invoices
- Invoice lines
- Invoice status history
- Tax rules
- Tax snapshots
- Discount rules
- Discount applications
- Discount usage counters
- Payments
- Payment allocations
- Payment attempts
- Payment-provider events
- Credit notes
- Refunds
- Customer credit balances
- Credit transactions
- Usage meters
- Usage events
- Usage aggregations
- Entitlement balances
- Notifications
- Email delivery records
- Outbox events
- Audit logs
- Idempotency keys
- Billing discrepancies
- Financial correction approvals

Every table must have appropriate:

- Primary keys.
- Foreign keys.
- Uniqueness constraints.
- Check constraints.
- Database indexes.
- Timestamp fields.
- Appropriate deletion rules.

Use UUIDs or another defensible identifier strategy.

Do not expose database sequential IDs as proof of authorization.

Use financial transactions and immutable snapshots where required.

Do not store secrets, card credentials, or raw authentication tokens in ordinary business tables.

---

# SECTION 23 — SECURITY REQUIREMENTS

**SECURITY IS A RELEASE BLOCKER.**

Treat this as a financial business application handling sensitive customer and payment information.

Target OWASP ASVS 5.0 Level 2 for the application and stronger verification for sensitive financial and administrative functionality.

Security must be implemented throughout the backend, database, frontend, infrastructure, and development pipeline.

No generated application can truthfully be guaranteed perfectly secure, so provide actual verifiable evidence of the controls implemented.

## 23.1 Threat modeling

Create a threat model covering:

- Customer account takeover.
- Administrator compromise.
- Unauthorized invoice access.
- Cross-customer data exposure.
- Privilege escalation.
- Payment manipulation.
- Duplicate billing.
- Unauthorized refund approval.
- Malicious webhook payloads.
- Data exfiltration.
- Injection attacks.
- Malicious file uploads.
- Supply-chain compromise.
- Denial-of-service attempts.
- Insider misuse.
- Billing worker compromise.

Document trust boundaries, attack surfaces, assets, mitigations, and residual risks.

## 23.2 Access control

Implement:

- Deny-by-default authorization.
- Server-side RBAC.
- Record-level authorization.
- Field-level restrictions for sensitive attributes.
- Least-privilege database access.
- Separation of duties.
- Privileged-operation confirmation.
- MFA for high-privilege accounts.
- Cross-customer isolation.
- Protection against IDOR/BOLA.
- Secure admin-only staff invitations.

Every endpoint must independently check permissions.

## 23.3 Session security

Implement:

- Secure cookie attributes.
- Session rotation.
- Session revocation.
- Expiration and inactivity timeouts.
- CSRF protection.
- Protection against session fixation.
- Safe logout.
- Reauthentication for critical actions.
- No authentication tokens in URL parameters.
- No persistent authentication secrets in localStorage.

## 23.4 Input and output security

Implement protection against:

- SQL injection.
- Cross-site scripting.
- Cross-site request forgery.
- Server-side request forgery.
- Command injection.
- Path traversal.
- Open redirects.
- Mass assignment.
- Prototype pollution.
- Unsafe deserialization.
- Malicious file uploads.
- API parameter tampering.

Use prepared/parameterized queries through the ORM, strict schema validation, output encoding, allowlists, and safe file handling.

Do not rely on frontend validation alone.

## 23.5 HTTP and network security

Use:

- HTTPS in deployment.
- Correct TLS configuration.
- HSTS where applicable.
- Content Security Policy.
- Appropriate security headers.
- Restricted CORS.
- Safe cookie policies.
- Request body limits.
- Rate limits.
- Reverse-proxy security configuration.
- Private database networking.
- No publicly exposed database administration ports.

## 23.6 Financial operation security

- Transactional invoice creation.
- Idempotent payment processing.
- Webhook signature verification.
- No trusting frontend payment success.
- Immutable issued-invoice history.
- Approval workflow for sensitive adjustments.
- Ledger-like credit and refund tracking.
- Currency consistency.
- Exact monetary arithmetic.
- Audit records for financial changes.
- Reconciliation checks.
- Prevention of duplicate refunds.
- Prevention of duplicate billing.

## 23.7 Secrets management

- No hardcoded API keys.
- No secrets committed to Git.
- `.env.example` containing placeholders only.
- Secret validation on startup.
- Different development and production secrets.
- Least-privilege external credentials.
- Restricted access to payment credentials.
- Sensitive-data redaction in logs.
- Secret rotation procedures.

## 23.8 Data protection

- Data minimization.
- Encryption in transit.
- Appropriate encryption at rest.
- Secure backups.
- Backup restoration testing.
- Defined retention policies.
- Controlled data export.
- Sensitive-field masking.
- Audit-log access restrictions.
- Safe deletion and anonymization policies that preserve legally required financial records.

## 23.9 Audit trails

Record:

- Actor.
- Action.
- Target object.
- Timestamp.
- Result.
- Relevant before/after changes.
- Authorization context.
- Request correlation ID.

Prevent unauthorized alteration of audit history.

Avoid logging passwords, tokens, full payment credentials, or unnecessary sensitive customer information.

## 23.10 Dependency and infrastructure security

- Lock dependency versions.
- Run dependency vulnerability scans.
- Run static analysis.
- Run secret scanning.
- Use minimal container images.
- Use non-root application containers.
- Configure health checks.
- Restrict container privileges.
- Minimize exposed ports.
- Validate infrastructure configuration.
- Document dependency licenses.

Do not copy third-party repository code without checking its license.

---

# SECTION 24 — PERFORMANCE AND SCALABILITY

The challenge requires typical pages to respond within two seconds when handling thousands of subscriptions.

Implement and measure this requirement.

## Minimum benchmark dataset

Generate deterministic seed data containing at least:

- 5,000 subscriptions.
- 20,000 invoices.
- Associated customers.
- Plans.
- Payment records.
- Discounts.
- Taxes.
- Relevant lifecycle states.

## Optimization

Implement:

- Database indexes.
- Server-side pagination.
- Efficient filtering.
- Bounded query results.
- Aggregated reporting queries.
- Appropriate caching.
- Avoidance of N+1 queries.
- Efficient billing batch processing.
- Database connection pooling.
- Asynchronous notification delivery.
- Query execution analysis.

Measure page/API response latency with a documented workload, dataset, and machine profile.

Target p95 response times below two seconds for representative business pages under the defined test workload.

Report actual measurements.

Do not claim the performance requirement is achieved without running a benchmark.

---

# SECTION 25 — TESTING AND QUALITY ASSURANCE

Develop a substantial automated testing suite.

## Unit testing

Test:

- Plan price calculation.
- Product variant adjustments.
- Quantity validation.
- Discount eligibility.
- Discount limits.
- Tax calculation.
- Recurring billing schedule.
- Monthly date boundaries.
- Leap years.
- Subscription state transitions.
- Proration.
- Usage aggregation.
- Credit calculation.
- Invoice totals.
- Payment balances.
- Financial analytics formulas.

## Integration testing

Test:

- Registration and authentication.
- Staff invitation permissions.
- Customer isolation.
- Product-to-plan relationships.
- Quotation conversion.
- Subscription activation.
- Recurring invoice creation.
- Payment allocation.
- Refund approvals.
- Email outbox processing.
- Webhook processing.
- Billing verification.
- Database rollback.

## Security testing

Test:

- Unauthorized admin requests.
- Customer viewing another customer's invoices.
- Cross-customer record modification.
- Privilege escalation attempts.
- CSRF protection.
- Login brute-force protections.
- Invalid session rejection.
- Malicious input handling.
- Replay of webhook events.
- Duplicate payment events.
- Duplicate invoice generation.
- Concurrent financial changes.
- Unauthorized refund operations.

## Browser testing

Using Playwright, test:

1. Admin login.
2. Product creation.
3. Plan creation.
4. Customer registration.
5. Quotation generation.
6. Quotation acceptance.
7. Subscription activation.
8. Billing job execution.
9. Invoice generation.
10. Invoice PDF download.
11. Payment recording.
12. Invoice paid status.
13. Finance dashboard update.
14. Customer invoice access.
15. Unauthorized access rejection.
16. Subscription pause and renewal.
17. Discount expiration.
18. Billing discrepancy detection.
19. Correction approval.
20. Logout and session invalidation.

## Critical reliability test

Run the same billing job twice and verify that no duplicate financial invoice is created.

Also test two concurrent billing workers attempting to process the same subscription period.

## Testing quality gates

- TypeScript compilation passes.
- Linting passes.
- Database migrations pass.
- Core unit tests pass.
- API tests pass.
- Browser tests pass.
- No known critical or high-severity security finding is left unaddressed without explicit risk documentation and a justified exception.
- Financial test fixtures reproduce exactly.

---

# SECTION 26 — REFERENCE REPOSITORIES TO STUDY

Use the following repositories as references for behavior and architecture.

Do not blindly copy their code.

1. ERPNext — https://github.com/frappe/erpnext  
   Study customers, quotations, subscriptions, recurring invoices, accounting, taxes, payments and reporting.

2. Odoo — https://github.com/odoo/odoo  
   Study products, variants, quotations, contract workflows, pricing and business UI. Distinguish Community and commercial-only features.

3. OCA Contract — https://github.com/OCA/contract  
   Study recurring contracts, invoice scheduling, quantity changes and termination.

4. Kill Bill — https://github.com/killbill/killbill  
   Study catalog design, lifecycle state machines, subscriptions, recurring billing, proration, invoice and payment processing.

5. Lago — https://github.com/getlago/lago  
   Study subscription pricing, advanced billing, usage events, credits, and entitlements.

6. Invoice Ninja — https://github.com/invoiceninja/invoiceninja  
   Study invoices, quotations, recurring billing, customer portals, payments, reminders and PDF interfaces. Respect license restrictions.

7. FOSSBilling — https://github.com/FOSSBilling/FOSSBilling  
   Study customer management, recurring-service billing, notifications, payment providers and administrator operations.

8. SolidInvoice — https://github.com/SolidInvoice/SolidInvoice  
   Study quotations, recurring invoices, financial precision, tax rules, payments and invoice states.

9. Akaunting — https://github.com/akaunting/akaunting  
   Study financial dashboards, transaction tracking and accounting-oriented reporting.

10. Dolibarr — https://github.com/Dolibarr/dolibarr  
    Study products, contracts, commercial proposals, subscriptions and invoices.

11. Crater — https://github.com/crater-invoice-inc/crater  
    Study invoice and estimate UI. Verify implemented features rather than assuming roadmap entries exist.

12. OpenMeter — https://github.com/openmeterio/openmeter  
    Study usage metering, entitlements, credits and billing-related API design.

13. Stripe Subscription Samples — https://github.com/stripe-samples/subscription-use-cases  
    Study checkout, subscription integration, webhooks and payment sandbox workflows.

The goal is to understand established design patterns and implement an original, coherent Brightloop application.

If browsing or cloning references is unavailable, use documented requirements and existing project context rather than pretending to have inspected their code.

---

# SECTION 27 — COMMERCIAL PRODUCT FEATURE REFERENCES

Use documented product behavior as design inspiration.

## Stripe Billing

Incorporate relevant concepts:

- Recurring billing.
- Flexible subscription pricing.
- Hosted checkout.
- Customer portal.
- Quotation conversion.
- Subscription schedules.
- Proration.
- Coupons.
- Automated invoices.
- Payment recovery.
- Tax calculations.
- Subscription analytics.

## Zoho Billing

Incorporate:

- Product and plan catalog.
- Subscription management.
- Customer self-service.
- Quotations.
- Tax configuration.
- Automated invoicing.
- Discounts.
- Payment recording.
- Dunning.
- Renewal management.
- Reports.

## Chargebee

Incorporate:

- Product catalog.
- Complex pricing.
- CPQ-style quotations.
- Quote-to-subscription workflow.
- Contract pricing.
- Subscription changes.
- Invoicing.
- Credit management.
- Revenue insights.
- Payment collection workflows.

## Recurly

Incorporate:

- Subscription lifecycle.
- Payment failure tracking.
- Dunning schedules.
- Collection reminders.
- Subscriber retention reporting.
- Churn reporting.
- Recovery analytics.

## Zuora

Incorporate:

- Enterprise contract management.
- Flexible rate plans.
- Usage-based billing.
- Bill runs.
- Invoicing.
- Credits.
- Payment settlement.
- Financial reporting.
- Contract amendments.

## Maxio

Incorporate:

- Contract subscription management.
- Hybrid billing.
- Revenue schedules.
- Financial dashboards.
- MRR and ARR.
- Retention metrics.
- Collections monitoring.
- Auditability.

## Paddle

Study:

- Customer checkout.
- Localized prices.
- Recurring payment workflows.
- Subscription APIs.
- Tax calculation interfaces.
- Failed-payment handling.

Do not recreate Paddle's merchant-of-record business model.

## Razorpay Subscriptions

Study:

- Indian recurring payments.
- Hosted payment integration.
- Mandate-based workflows when supported.
- Subscription API operations.
- Secure webhooks.
- Payment status verification.

Use approved payment-provider integrations rather than processing sensitive payment credentials ourselves.

---

# SECTION 28 — LOCAL DEMONSTRATION REQUIREMENTS

The application must function locally without requiring production payment accounts, paid AI APIs, or paid infrastructure.

Create a realistic seeded Brightloop business environment.

## Demo accounts

Provide a safe development-only mechanism to create:

- One administrator.
- One sales employee.
- One finance employee.
- One support employee.
- Multiple customer accounts.

Generate demo credentials only during local seed execution.

Never ship known demo passwords or publicly accessible demonstration accounts into production.

## Demo data

Include:

- Multiple software products.
- Variants and add-ons.
- Daily, weekly, monthly and yearly plans.
- Products with different tax rules.
- Discounts with validity and usage limits.
- An Odoo-branded variant with a 560 price increment.
- Valid and expired quotations.
- Active subscriptions.
- Paused subscriptions.
- Closed subscriptions.
- Subscriptions approaching renewal.
- Paid invoices.
- Partially paid invoices.
- Overdue invoices.
- Missing invoice fixture.
- Duplicate-invoice attempt fixture.
- Underbilled invoice fixture.
- Overbilled invoice fixture.
- Usage-based billing fixture.
- Prepaid credit fixture.
- Credit note fixture.
- Refund approval fixture.

## Working demo journey

The following must run end to end:

Admin creates product
→ Admin creates monthly plan
→ Customer registers
→ Sales employee generates quotation
→ Customer accepts
→ Subscription becomes active
→ Billing worker creates invoice
→ Customer opens invoice
→ Finance records payment
→ Invoice reflects the payment
→ Finance dashboard updates.

Then show:

- Billing the same period twice without creating duplicates.
- Discount expiry.
- Subscription renewal.
- A partial payment.
- An overdue invoice.
- A billing discrepancy identified by ProofBill.
- An authorized correction with an audit trail.

All demo data should be consistent and stored in the database.

---

# SECTION 29 — DEVELOPMENT EXECUTION PLAN

Work in sequential, independently testable phases.

## Phase 1 — Repository and database foundation

- Inspect the existing repository before modifying it.
- Establish architecture.
- Configure TypeScript, workspace, linting, tests and Docker.
- Create PostgreSQL schema.
- Set up migrations.
- Implement authentication and authorization.
- Implement customer records.
- Establish an audit framework.

## Phase 2 — Product and pricing configuration

- Products.
- Variants.
- Add-ons.
- Plan management.
- Pricing methods.
- Taxes.
- Discounts.
- Validation.

## Phase 3 — Sales and subscriptions

- Quotation templates.
- Quotations.
- Customer acceptance.
- Subscription creation.
- Subscription lifecycle.
- Plan changes.
- Renewal policies.

## Phase 4 — Financial engine

- Recurring billing worker.
- Billing periods.
- Invoices.
- Idempotency.
- PDF generation.
- Payment recording.
- Reconciliation.
- Credits.
- Refunds.

## Phase 5 — Advanced subscription capabilities

- Usage billing.
- Entitlements.
- Prepaid credits.
- Trials.
- Proration.
- Contract-specific pricing.
- Consolidated billing.
- Notification and recovery workflows.

## Phase 6 — Dashboards and customer portal

- Admin dashboard.
- Staff operations.
- Finance reporting.
- Customer portal.
- Subscription self-service.
- Advanced SaaS metrics.

## Phase 7 — Billing integrity

- ProofBill verification.
- Explain This Bill.
- Preview Next Invoice.
- Discrepancy workflow.
- Financial approval controls.

## Phase 8 — Security, performance and delivery

- Threat model.
- Security tests.
- Dependency scan.
- Browser tests.
- Performance benchmarks.
- Docker deployment.
- Documentation.
- Demo walkthrough.

### Execution rules

Do not stop after writing documentation or displaying mock screens.

Implement each phase in code, run the relevant tests, repair failures, and commit coherent changes when a Git repository is configured.

Maintain a persistent requirements checklist containing:

- Feature name.
- Source requirement or product inspiration.
- Implementation status.
- Relevant files.
- API endpoints.
- Test evidence.
- Known limitations.

Only mark a feature COMPLETE after implementation and verification.

Do not claim external payment integrations, email delivery, production readiness, or security assurance has been verified if valid credentials, infrastructure, or tests were unavailable.

If a capability cannot be completed, explicitly report its remaining work and keep the system stable.

Prioritize the mandatory Brightloop workflow before advanced commercial-product enhancements if time or resources become constrained.

Do not trade away billing correctness, data isolation, or security for visual features.

---

# SECTION 30 — DOCUMENTATION AND FINAL DELIVERABLES

Produce:

1. Complete source code.
2. Working frontend.
3. Working backend.
4. PostgreSQL database schema.
5. Database migrations.
6. Working billing worker.
7. Required business workflows.
8. Role-based dashboards.
9. Customer portal.
10. Financial reports.
11. Billing verification module.
12. Automated testing suite.
13. Docker Compose configuration.
14. `.env.example`.
15. Comprehensive README.
16. Architecture diagram.
17. Database relationship diagram.
18. API documentation.
19. Security architecture.
20. Threat model.
21. Setup instructions.
22. Seed-data instructions.
23. Demonstration guide.
24. Performance report.
25. Test report.
26. Feature implementation matrix.
27. Known limitations report.
28. Security and operational deployment checklist.
29. License and attribution inventory.
30. Optional payment-provider configuration guide.

The README must explain how to run a fresh checkout.

Provide commands for:

- Installing dependencies.
- Creating the development environment.
- Starting PostgreSQL.
- Running migrations.
- Loading seed data.
- Starting frontend, backend and billing worker.
- Running unit tests.
- Running integration tests.
- Running browser tests.
- Running performance tests.
- Building the production application.

Use repeatable commands appropriate to the selected package manager and operating system.

---

# SECTION 31 — FINAL ACCEPTANCE CRITERIA

The project is not functionally complete until the following are verified:

- Users can register and authenticate securely.
- Admin and staff permissions work.
- Customers cannot access other customers' information.
- Products and variants are manageable.
- Plans support all mandatory billing frequencies.
- Quotations can be created from templates.
- Accepted quotations can become subscriptions.
- Subscription lifecycle transitions function.
- Billing schedules create correct invoices.
- The same period is not invoiced twice.
- Missed billing periods can be recovered.
- Taxes and discounts calculate correctly.
- Expired discounts do not apply.
- Invoices have correct line items and statuses.
- Payments reconcile to invoices.
- Outstanding and overdue amounts are accurate.
- Customer self-service works.
- Reporting uses real database records.
- Advanced pricing and usage features operate according to their documented rules.
- Credit and refund records are auditable.
- ProofBill identifies defined billing discrepancies.
- Notifications are queued and processed reliably.
- The application is responsive.
- Financial API authorization is enforced.
- Security scans and tests have been executed.
- Performance results are measured.
- The application works from a documented fresh checkout.

For every major feature, provide a functioning demonstration or automated test proving its behavior.

---

# SECTION 32 — FINAL INSTRUCTIONS

Build the application as a serious financial business product, not a visual hackathon prototype.

Your key priorities are:

**Correctness → Security → Complete Business Functionality → Reliability → Usability → Performance → Advanced Features.**

Use real persistent data.

Use reliable financial mathematics.

Use transaction-safe billing operations.

Keep security controls integrated from the start.

Avoid unnecessary architecture complexity.

Keep the application fully usable for the Brightloop single-company scenario.

Do not replace the mandatory workflow with an AI chatbot, marketplace, or unrelated innovation.

Implement all listed applicable features in logical phases, and maintain an honest record of what has and has not been completed.

Begin by inspecting the repository, confirming the architecture, constructing the requirements matrix and database design, and then implementing the application immediately.

**The final outcome must be a fully integrated Subscription Management System that can demonstrate its core functions, verify its billing calculations, and provide a clear record of its tested security and operational limitations.**