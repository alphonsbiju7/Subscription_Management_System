import "dotenv/config";
import { readFileSync } from "node:fs";
import { totp } from "./totp.js";
if (process.env.NODE_ENV === "production") throw new Error("Development only");
const data = JSON.parse(
  readFileSync(".local/demo-credentials.json", "utf8"),
) as { accounts: { email: string; role: string; totpSecret?: string }[] };
const user = data.accounts.find(
  (a) => a.role.toLowerCase() === (process.argv[2] ?? "admin").toLowerCase(),
);
if (!user?.totpSecret) throw new Error("No demo authenticator for that role");
console.log(
  `${user.email}: ${totp(user.totpSecret)} (expires in ${30 - (Math.floor(Date.now() / 1000) % 30)}s)`,
);
