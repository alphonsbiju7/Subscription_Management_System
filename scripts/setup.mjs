import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
mkdirSync(".local", { recursive: true });
if (!existsSync(".env")) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".env",
    `NODE_ENV=development\nPORT=3001\nDATABASE_URL=postgresql://brightloop:${password}@127.0.0.1:55432/brightloop?schema=public\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\nBETTER_AUTH_URL=http://localhost:5173\nWEB_ORIGIN=http://localhost:5173\nBUSINESS_TIMEZONE=Asia/Kolkata\nSMTP_HOST=127.0.0.1\nSMTP_PORT=1025\nSMTP_FROM=Brightloop <billing@brightloop.local>\n`,
    { mode: 0o600 },
  );
  console.log("Created ignored .env with random local secrets.");
} else console.log("Kept existing .env.");
