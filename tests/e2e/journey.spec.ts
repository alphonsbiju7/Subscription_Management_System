import { test, expect, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { totp } from "../../scripts/totp.js";
type Account = {
  email: string;
  password: string;
  role: string;
  totpSecret?: string;
};
const data = JSON.parse(
  readFileSync(
    process.env.DEMO_CREDENTIALS_PATH ?? ".local/demo-credentials.json",
    "utf8",
  ),
) as { accounts: Account[] };
const admin = data.accounts.find((a) => a.role === "ADMIN")!,
  sales = data.accounts.find((a) => a.role === "SALES")!,
  finance = data.accounts.find((a) => a.role === "FINANCE")!;
async function login(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  if (account.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(account.totpSecret));
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(
    page.getByRole("heading", { name: /Revenue overview|Hello,/ }),
  ).toBeVisible();
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
}
test("admin workspace renders at desktop and mobile sizes, and every module opens", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, admin);
  await expect(
    page.getByText("Loading workspace data…", { exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    path: "artifacts/dashboard-desktop.png",
    fullPage: true,
  });
  for (const name of [
    "Customers",
    "Product catalog",
    "Plans & pricing",
    "Quotations",
    "Subscriptions",
    "Invoices",
    "Payments",
    "Credits & refunds",
    "Usage & entitlements",
    "Reports",
    "ProofBill",
    "Billing operations",
    "Tax rules",
    "Discounts",
    "Quote templates",
    "Notifications",
    "Team & access",
    "Audit trail",
    "Settings",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("link", { name, exact: true })
      .click();
    await expect(page.locator("main h1")).toBeVisible();
    await expect(
      page.getByText("Loading workspace data…", { exact: true }),
    ).not.toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Invoices", exact: true })
    .click();
  await expect(
    page.getByText("Loading workspace data…", { exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    path: "artifacts/invoices-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("product → plan → quote → customer acceptance → worker invoice → partial/full payment", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => void d.accept());
  const suffix = randomUUID().slice(0, 6),
    productName = `Browser CRM ${suffix}`,
    planName = `Browser Monthly ${suffix}`;
  const customerName = `Browser Customer ${suffix}`,
    customer: Account = {
      email: `browser-${suffix}@example.test`,
      password: `Browser!Aa${randomUUID()}`,
      role: "CUSTOMER",
    };
  await page.goto("/register");
  await page.getByLabel("Full name").fill(customerName);
  await page.getByLabel("Email address").fill(customer.email);
  await page.getByLabel("Password", { exact: true }).fill(customer.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("status")).toBeVisible();
  let verifyUrl = "";
  await expect
    .poll(
      () => {
        for (const file of readdirSync(".local/mail")) {
          const message = readFileSync(`.local/mail/${file}`, "utf8");
          if (message.includes(`To: ${customer.email}`)) {
            verifyUrl = message.match(/https?:\/\/[^\s]+/)?.[0] ?? "";
            if (verifyUrl) return true;
          }
        }
        return false;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await page.goto(verifyUrl);
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
  await logout(page);
  await login(page, admin);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Product catalog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create product", exact: true })
    .click();
  await page.getByLabel("Product name").fill(productName);
  await page.getByLabel("Sales price").fill("1000");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Plans & pricing", exact: true })
    .click();
  await page.getByRole("button", { name: "Create plan", exact: true }).click();
  await page
    .getByLabel("Product", { exact: true })
    .selectOption({ label: productName });
  await page.getByLabel("Plan name").fill(planName);
  await page.getByLabel("Recurring unit / base price").fill("1000");
  await page.getByRole("button", { name: "Save record", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await logout(page);
  await login(page, sales);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Quotations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create quotation", exact: true })
    .click();
  await page
    .getByLabel("Customer", { exact: true })
    .selectOption({ label: customerName });
  const planOption = await page
    .getByLabel("Plan for line 1")
    .locator("option")
    .filter({ hasText: planName })
    .getAttribute("value");
  await page.getByLabel("Plan for line 1").selectOption(planOption!);
  await page.getByRole("button", { name: "Create draft quotation" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const firstRow = page.locator("tbody tr").filter({ hasText: customerName });
  await expect(firstRow).toHaveCount(1);
  const quoteNumber = await firstRow.locator("td").first().innerText();
  await firstRow.getByRole("button", { name: "Send", exact: false }).click();
  await logout(page);
  await login(page, customer);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Quotations", exact: true })
    .click();
  await page.getByRole("button", { name: quoteNumber, exact: true }).click();
  await page
    .getByRole("button", { name: "Accept quotation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Converted subscriptions" }),
  ).toBeVisible();
  const subscription = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Converted subscriptions" }),
    })
    .getByRole("link")
    .first();
  const href = await subscription.getAttribute("href");
  await logout(page);
  await login(page, sales);
  await page.goto(href!);
  await page.getByRole("button", { name: "Activate subscription" }).click();
  await expect(
    page.getByRole("button", { name: "Pause subscription" }),
  ).toBeVisible();
  await logout(page);
  await login(page, finance);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Billing operations", exact: true })
    .click();
  await page.getByRole("button", { name: "Queue due billing" }).click();
  await page.goto(href!);
  await expect
    .poll(
      async () => {
        await page.reload();
        return await page
          .locator("section")
          .filter({
            has: page.getByRole("heading", { name: "Invoice history" }),
          })
          .locator("tbody tr")
          .count();
      },
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  const invoiceButton = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Invoice history" }) })
    .getByRole("button")
    .first();
  await invoiceButton.click();
  await page
    .getByRole("button", { name: "Confirm invoice", exact: true })
    .click();
  await expect(page.getByText("UNPAID", { exact: true })).toBeVisible();
  const invoiceId = page.url().split("/").at(-1)!;
  const invoiceNumber = await page.locator("main h1").innerText();
  const pdf = await page
    .context()
    .request.get(`/api/v1/invoices/${invoiceId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  for (const amount of ["400", "600"]) {
    await page.goto("/payments");
    await page
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await page
      .getByLabel("Customer", { exact: true })
      .selectOption({ label: customerName });
    await page
      .getByLabel("Unique bank / transaction reference")
      .fill(`BROWSER-${randomUUID()}`);
    await page.getByLabel("Payment received", { exact: true }).fill(amount);
    await page
      .getByLabel("Allocate to invoice")
      .selectOption({ label: invoiceNumber });
    await page
      .getByRole("button", { name: "Save record", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await page.goto(`/invoices/${invoiceId}`);
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();
  await expect(
    page.getByText("SNAPSHOT VERIFIED", { exact: true }),
  ).toBeVisible();
  await logout(page);
  await login(page, customer);
  await page.goto(`/invoices/${invoiceId}`);
  await expect(
    page.getByRole("heading", { name: "Explain this bill" }),
  ).toBeVisible();
  await page.goto(href!);
  await page.getByRole("button", { name: "Pause subscription" }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page
    .getByRole("button", { name: "Renew agreement", exact: true })
    .click();
  await logout(page);
});
