import "dotenv/config";
import { readFileSync } from "node:fs";
import { totp } from "./totp.js";
if (process.env.NODE_ENV === "production") throw new Error("Development only");
const arguments_ = process.argv.slice(2);
const selector = arguments_.find((argument) => argument !== "--hackathon") ?? "admin";
const hackathon = arguments_.includes("--hackathon") || selector.toLowerCase().endsWith("@brightloop.demo");
const data = JSON.parse(readFileSync(
  hackathon ? ".local/hackathon-demo-credentials.json" : ".local/demo-credentials.json", "utf8",
)) as { accounts: { email: string; role: string; totpSecret?: string }[] };
const user = data.accounts.find(
  (a) => a.role.toLowerCase() === selector.toLowerCase() || a.email.toLowerCase() === selector.toLowerCase(),
);
if (!user?.totpSecret) throw new Error("No demo authenticator for that role");
console.log(
  `${user.email}: ${totp(user.totpSecret)} (expires in ${30 - (Math.floor(Date.now() / 1000) % 30)}s)`,
);
