import { createApp } from "./app.js";
import { config } from "./config.js";
import { db, logger } from "./db.js";
const server = createApp().listen(config.PORT, "0.0.0.0", () =>
  logger.info({ port: config.PORT }, "Brightloop API ready"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      void db.$disconnect().then(() => process.exit(0));
    });
  });
