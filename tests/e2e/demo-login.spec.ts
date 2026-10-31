import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { totp } from "../../scripts/totp.js";

type DemoAccount = {
  email: string;
  password: string;
  role: string;
  totpSecret?: string;
};
type CurrentUser = {
  email: string;
  role: string;
  customerId: string | null;
  requiresMfa: boolean;
};
type CustomerRecord = { id: string; customerId: string };
type Collection = { items: CustomerRecord[] };

const credentials = JSON.parse(
  readFileSync(
    process.env.HACKATHON_DEMO_CREDENTIALS_PATH ??
      ".local/hackathon-demo-credentials.json",
    "utf8",
  ),
) as { accounts: DemoAccount[] };

// Authentication requests contain local credentials. Never retain browser
// traces, screenshots or videos from this suite in shareable test artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

const origin = "http://localhost:5173";
const protectedError =
  /administrator access required|do not have permission|access denied|not permitted|not authorized|forbidden/i;
const rolePages: Record<string, { path: string; heading: string }[]> = {
  ADMIN: [
    { path: "/staff", heading: "Team & access" },
    { path: "/settings", heading: "Settings & integrations" },
    { path: "/customers", heading: "Customers" },
  ],
  CUSTOMER: [
    { path: "/subscriptions", heading: "Subscriptions" },
    { path: "/invoices", heading: "Invoices" },
    { path: "/payments", heading: "Payments" },
  ],
  SALES: [
    { path: "/customers", heading: "Customers" },
    { path: "/quotes", heading: "Quotations" },
  ],
  FINANCE: [
    { path: "/invoices", heading: "Invoices" },
    { path: "/payments", heading: "Payments" },
  ],
  SUPPORT: [
    { path: "/customers", heading: "Customers" },
    { path: "/subscriptions", heading: "Subscriptions" },
    { path: "/payments", heading: "Payments" },
  ],
};

async function signIn(page: Page, account: DemoAccount) {
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  if (account.totpSecret) {
    await expect(page.getByLabel("Authenticator code")).toBeVisible();
    await page.getByLabel("Authenticator code").fill(totp(account.totpSecret));
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }
  await expect(page).toHaveURL(`${origin}/`);
  await expect(
    page.getByRole("heading", { name: /Revenue overview|Hello,/ }),
  ).toBeVisible();
  await expect(page.locator(".user-control small")).toHaveText(
    account.role.toLowerCase(),
  );
}

async function assertOwnCollections(page: Page, customerId: string) {
  for (const path of ["/subscriptions", "/invoices", "/payments"]) {
    const response = await page.request.get(`/api/v1${path}?limit=100`);
    expect(response.status(), `${path} can be read`).toBe(200);
    const data = (await response.json()) as Collection;
    expect(
      data.items.length,
      `${path} has seeded demo records`,
    ).toBeGreaterThan(0);
    expect(
      data.items.every((item) => item.customerId === customerId),
      `${path} only contains the signed-in customer's records`,
    ).toBe(true);

    // An explicit foreign filter must never override the authenticated scope.
    const foreign = await page.request.get(
      `/api/v1${path}?customerId=another-customer&limit=100`,
    );
    expect(foreign.status()).toBe(200);
    const filtered = (await foreign.json()) as Collection;
    expect(
      filtered.items.every((item) => item.customerId === customerId),
      `${path} rejects attempts to widen customer scope`,
    ).toBe(true);
  }
}

for (const role of ["ADMIN", "CUSTOMER", "SALES", "FINANCE", "SUPPORT"]) {
  test(`${role}: demo login, session persistence, permissions and logout`, async ({
    page,
  }) => {
    const email = `${role.toLowerCase()}@brightloop.demo`;
    const account = credentials.accounts.find(
      (candidate) => candidate.email === email,
    );
    if (!account || account.role !== role)
      throw new Error(`Missing correctly assigned ${role} demo account`);

    await page.goto("/login");
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
    expect((await page.request.get("/api/v1/subscriptions")).status()).toBe(401);

    // Exactly one invalid attempt per account exercises the real password
    // comparison without exhausting the per-account authentication limiter.
    await page.getByLabel("Email address").fill(account.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Incorrect-demo-password!2026");
    await page.getByRole("button", { name: "Sign in to workspace" }).click();
    await expect(page.getByRole("alert")).toContainText(
      /incorrect|invalid|failed|password|credentials/i,
    );
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);

    await signIn(page, account);
    const meResponse = await page.request.get("/api/v1/me");
    expect(meResponse.status()).toBe(200);
    const me = (await meResponse.json()) as CurrentUser;
    expect(me.email).toBe(email);
    expect(me.role).toBe(role);
    expect(me.requiresMfa).toBe(false);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Revenue overview|Hello,/ }),
    ).toBeVisible();
    await expect(page.locator(".user-control small")).toHaveText(
      role.toLowerCase(),
    );
    expect((await page.request.get("/api/v1/me")).status()).toBe(200);

    for (const { path, heading } of rolePages[role]!) {
      await page
        .getByRole("navigation")
        .getByRole("link", {
          name: heading === "Settings & integrations" ? "Settings" : heading,
          exact: true,
        })
        .click({ timeout: 30000 });
      await expect(page).toHaveURL(`${origin}${path}`, { timeout: 30000 });
      await expect(page.locator("main h1")).toContainText(heading);
      await expect(
        page.getByRole("status").filter({ hasText: "Loading workspace data" }),
      ).toHaveCount(0);
      await expect(page.locator("main [role=alert]")).toHaveCount(0);
      expect((await page.request.get(`/api/v1${path}`)).status()).toBe(200);
    }

    if (role === "CUSTOMER") {
      expect(me.customerId).toBeTruthy();
      await assertOwnCollections(page, me.customerId!);
    }

    if (role !== "ADMIN") {
      await expect(
        page.getByRole("navigation").getByRole("link", {
          name: "Team & access",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("navigation").getByRole("link", {
          name: "Settings",
          exact: true,
        }),
      ).toHaveCount(0);
      for (const path of ["/staff", "/settings"]) {
        expect((await page.request.get(`/api/v1${path}`)).status()).toBe(403);
        await page.goto(path);
        await expect(page.locator("main")).toContainText(protectedError);
      }
      expect(
        (await page.request.post("/api/v1/staff/invite", {
          headers: { Origin: origin },
          data: {},
        })).status(),
      ).toBe(403);
      expect(
        (await page.request.put("/api/v1/settings", {
          headers: { Origin: origin },
          data: {},
        })).status(),
      ).toBe(403);
    }

    if (!["ADMIN", "FINANCE"].includes(role)) {
      expect(
        (await page.request.post("/api/v1/payments", {
          headers: { Origin: origin },
          data: {},
        })).status(),
      ).toBe(403);
    }

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    // Wait for the sign-out navigation to finish before opening a protected URL.
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
    expect((await page.request.get("/api/v1/subscriptions")).status()).toBe(401);
    await page.goto("/subscriptions");
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(page.locator(".user-control")).toHaveCount(0);
  });
}

test("development loopback URL redirects to the canonical login origin", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5173/login");
  await expect(page).toHaveURL(`${origin}/login`);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByText("Development demo accounts", { exact: true }).click();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("sales@brightloop.demo");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");

  const localCredentialsPath = `${process.cwd().replaceAll("\\", "/")}/.local/hackathon-demo-credentials.json`;
  const localFile = await page.request.get(`/@fs/${localCredentialsPath}`);
  // Inspect only the status: a failing assertion must never print file contents.
  expect([403, 404]).toContain(localFile.status());
});
