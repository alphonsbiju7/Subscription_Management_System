# License and attribution inventory

The application implementation is original. No source was copied from ERPNext, Odoo, OCA, Kill Bill, Lago, Invoice Ninja, FOSSBilling, SolidInvoice, Akaunting, Dolibarr, Crater, OpenMeter or Stripe samples. The supplied brief names their workflows as inspiration; no claim is made that their codebases were all inspected.

Official Better Auth installation, Express, email/password, database and TOTP documentation were inspected, together with installed package type declarations. Embedded PostgreSQL's upstream usage and platform support were inspected. These sources informed integration behavior without incorporating repository code.

- [Better Auth installation](https://better-auth.com/docs/installation)
- [Express integration](https://better-auth.com/docs/integrations/express)
- [Email/password](https://better-auth.com/docs/authentication/email-password)
- [Two-factor authentication](https://better-auth.com/docs/plugins/2fa)
- [Database schema](https://better-auth.com/docs/concepts/database)
- [Embedded PostgreSQL](https://github.com/leinelissen/embedded-postgres)

Run `npm run licenses` to regenerate `dependency-licenses.json` from the lockfile and installed production package manifests. Preserve upstream package notices when distributing builds. MIT/Apache/BSD/ISC and other dependencies retain their own license terms; the JSON inventory is not a legal compatibility opinion. Native PostgreSQL binaries are distributed by the embedded package and carry PostgreSQL/upstream notices.

The original repository supplied no project LICENSE. This change does not invent licensing authority on behalf of its owner. Maintainers must select the application's redistribution license before publishing it as licensed open source. The user-supplied implementation prompt is preserved as a requirements artifact.
