import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { totp } from "../../scripts/totp.js";

type TestAccount = {
  email: string;
  password: string;
  role: string;
  totpSecret?: string;
};
const accounts = (
  JSON.parse(
    readFileSync(
      process.env.DEMO_CREDENTIALS_PATH ?? ".local/demo-credentials.json",
      "utf8",
    ),
  ) as { accounts: TestAccount[] }
).accounts;
const admin = accounts.find((user) => user.role === "ADMIN")!;
const customer = accounts.filter((user) => user.role === "CUSTOMER").at(-1)!;
let adminApi: APIRequestContext, customerApi: APIRequestContext;
async function login(page: Page, user: TestAccount) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  if (user.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(user.totpSecret));
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(
    page.getByRole("heading", { name: /Revenue overview|Hello,/ }),
  ).toBeVisible();
}
test.beforeAll(async ({ playwright }) => {
  async function apiSession(user: TestAccount) {
    const context = await playwright.request.newContext({
      baseURL: "http://localhost:5173",
      extraHTTPHeaders: { Origin: "http://localhost:5173" },
    });
    const response = await context.post("/api/auth/sign-in/email", {
      data: { email: user.email, password: user.password },
    });
    expect(response.ok()).toBe(true);
    if (user.totpSecret) {
      const verified = await context.post("/api/auth/two-factor/verify-totp", {
        data: { code: totp(user.totpSecret) },
      });
      expect(verified.ok()).toBe(true);
    }
    return context;
  }
  adminApi = await apiSession(admin);
  customerApi = await apiSession(customer);
});
test.afterAll(async () => {
  await adminApi?.dispose();
  await customerApi?.dispose();
});
async function freshInvoice() {
  async function post(path: string, data: object, context = adminApi) {
    const response = await context.post(`/api/v1${path}`, {
      data,
      headers: { "Idempotency-Key": randomUUID() },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const me = (await (await customerApi.get("/api/v1/me")).json()) as {
    customerId: string;
  };
  const product = (await post("/products", {
    name: `Checkout browser ${randomUUID()}`,
    salesPrice: "1000",
  })) as { id: string };
  const plan = (await post("/plans", {
    name: "Demo checkout monthly",
    productId: product.id,
    price: "1000",
    interval: "MONTHLY",
  })) as { versions: { id: string }[] };
  const quote = (await post("/quotes", {
    customerId: me.customerId,
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    lines: [{ planVersionId: plan.versions[0]!.id, quantity: 1 }],
  })) as { id: string };
  await post(`/quotes/${quote.id}/send`, {});
  const sub = (await post(`/quotes/${quote.id}/accept`, {}, customerApi)) as {
    id: string;
  };
  await post(`/subscriptions/${sub.id}/action`, { action: "activate" });
  await post("/billing/run", { subscriptionId: sub.id });
  let invoiceId = "";
  await expect
    .poll(
      async () => {
        const subscription = (await (
          await adminApi.get(`/api/v1/subscriptions/${sub.id}`)
        ).json()) as { invoices: { id: string }[] };
        invoiceId = subscription.invoices[0]?.id ?? "";
        return invoiceId;
      },
      { timeout: 20000 },
    )
    .not.toBe("");
  await post(`/invoices/${invoiceId}/confirm`, {});
  return (await (
    await customerApi.get(`/api/v1/invoices/${invoiceId}`)
  ).json()) as { id: string; number: string; total: string };
}
test("customer partial checkout, visible failure, finance retry and recovery on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const invoice = await freshInvoice();
  await login(page, customer);
  await page.goto(`/invoices/${invoice.id}`);
  await page.getByRole("link", { name: "Pay Now", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pay your invoice" }),
  ).toBeVisible();
  await expect(page.getByText("DEMO MODE — simulated payments")).toBeVisible();
  await page.getByLabel("Payment portion").selectOption("HALF");
  await page.getByRole("button", { name: "Complete Demo Payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo payment successful" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your partial payment is recorded.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Pay remaining balance" }).click();
  await page.getByLabel("Demo scenario").selectOption("FAIL_ONCE");
  await page.getByRole("button", { name: "Complete Demo Payment" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo payment failed" }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulated temporary payment decline", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/demo-payment-failure.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await login(page, admin);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Payment Recovery", exact: true })
    .click();
  await page.getByLabel("Search payment recovery").fill(invoice.number);
  await page.getByRole("link", { name: "View details", exact: true }).click();
  await page.getByLabel("Immediate demo retry result").selectOption("FAILURE");
  await page.getByRole("button", { name: "Retry now", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await adminApi.get(
        `/api/v1/payment-recovery?search=${encodeURIComponent(invoice.number)}`,
      );
      const data = (await response.json()) as {
        items: { retryCount: number }[];
      };
      return data.items[0]?.retryCount;
    })
    .toBe(1);
  await expect(page.getByText("1 / 3", { exact: true })).toBeVisible();
  await page.getByLabel("Immediate demo retry result").selectOption("SUCCESS");
  await page.getByRole("button", { name: "Retry now", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment recovered", exact: true }),
  ).toBeVisible();
  const settled = (await (
    await adminApi.get(`/api/v1/invoices/${invoice.id}`)
  ).json()) as {
    amountPaid: string;
    outstanding: string;
    paymentStatus: string;
  };
  expect(settled.outstanding).toBe("0.00");
  expect(settled.paymentStatus).toBe("PAID");
  expect(Number(settled.amountPaid)).toBe(Number(invoice.total));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/payment-recovery-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/payment-recovery");
  await expect(
    page.getByRole("heading", { name: /^Payment Recovery/ }),
  ).toBeVisible();
  await expect(page.getByTestId("recovery-recoveredPayments")).toContainText(
    /\d+/,
  );
  expect(errors).toEqual([]);
});
