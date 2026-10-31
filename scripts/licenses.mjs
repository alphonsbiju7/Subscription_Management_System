import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const rows = [];
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path.includes("node_modules/") || meta.dev || meta.optional) continue;
  const name = path.split("node_modules/").at(-1);
  let license = meta.license ?? "UNKNOWN";
  if (existsSync(`${path}/package.json`)) {
    const pkg = JSON.parse(readFileSync(`${path}/package.json`, "utf8"));
    license = pkg.license ?? license;
  }
  rows.push({
    name,
    version: meta.version,
    license: typeof license === "string" ? license : JSON.stringify(license),
  });
}
rows.sort((a, b) => a.name.localeCompare(b.name));
mkdirSync("docs", { recursive: true });
writeFileSync("docs/dependency-licenses.json", JSON.stringify(rows, null, 2));
console.log(
  `Inventoried ${rows.length} production packages. See docs/dependency-licenses.json.`,
);
