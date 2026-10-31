import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  // Read server settings without allowing its development NODE_ENV to change
  // Vite's production build mode or expose development-only account helpers.
  const env = Object.assign({}, ...[".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`].map((name) => {
    const path = new URL(`../../${name}`, import.meta.url);
    return existsSync(path) ? parse(readFileSync(path)) : {};
  }), process.env) as Record<string, string | undefined>;
  const origin = new URL(env.WEB_ORIGIN ?? "http://localhost:5173");
  const canonicalLoginOrigin: Plugin = {
    name: "canonical-development-origin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requested = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        if (
          req.method === "GET" &&
          req.headers.accept?.includes("text/html") &&
          ["localhost", "127.0.0.1", "[::1]"].includes(requested.hostname) &&
          requested.host !== origin.host
        ) {
          res.writeHead(302, { Location: `${origin.origin}${requested.pathname}${requested.search}` });
          res.end();
          return;
        }
        next();
      });
    },
  };
  return {
    plugins: [react(), tailwind(), canonicalLoginOrigin],
    server: {
      port: Number(origin.port || 5173),
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${env.PORT ?? 3001}` },
      fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local/**"] },
    },
  };
});
