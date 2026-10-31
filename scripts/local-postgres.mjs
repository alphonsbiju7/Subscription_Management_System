import "dotenv/config";
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
if (process.env.NODE_ENV === "production")
  throw new Error("Embedded PostgreSQL is development-only");
const url = new URL(process.env.DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Local database URL required");
const pg = new EmbeddedPostgres({
  databaseDir: resolve(".local/postgres"),
  user: url.username,
  password: decodeURIComponent(url.password),
  port: Number(url.port),
  persistent: true,
  authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: console.error,
});
if (!existsSync(".local/postgres/PG_VERSION")) await pg.initialise();
await pg.start();
const client = pg.getPgClient(undefined, "127.0.0.1");
await client.connect();
const name = url.pathname.slice(1);
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))
  throw new Error("Unsafe database name");
const { rows } = await client.query(
  "SELECT 1 FROM pg_database WHERE datname = $1",
  [name],
);
if (!rows.length) await pg.createDatabase(name);
await client.end();
console.log(`PostgreSQL ready on 127.0.0.1:${url.port}. Ctrl+C to stop.`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await pg.stop();
    process.exit(0);
  });
setInterval(() => {}, 60_000);
