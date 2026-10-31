import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bsk_live_[A-Za-z0-9]{15,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgsk_[A-Za-z0-9]{30,}\b/,
];
const matches = [];
for (const path of files) {
  if (
    !path ||
    path === "scripts/scan-secrets.mjs" ||
    path === "package-lock.json"
  )
    continue;
  if (
    /(^|\/)(\.env|demo-credentials\.json)$/.test(path) &&
    path !== ".env.example"
  )
    matches.push(path);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (patterns.some((p) => p.test(source))) matches.push(path);
}
if (matches.length) {
  console.error("Potential secrets detected in:", ...new Set(matches));
  process.exitCode = 1;
} else
  console.log(
    `No recognized private keys or provider secrets found in ${files.length} source files. Pattern scanning is not a guarantee.`,
  );
