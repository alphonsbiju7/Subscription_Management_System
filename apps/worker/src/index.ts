import { db, logger } from "../../api/src/db.js";
import {
  enqueueDue,
  processJob,
  deliverNotification,
  queueReminders,
} from "./processor.js";
let stopping = false,
  lastReminder = 0;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
  });
logger.info("Brightloop billing worker started");
while (!stopping) {
  try {
    await enqueueDue();
    for (let i = 0; i < 10 && !stopping; i++) if (!(await processJob())) break;
    for (let i = 0; i < 25 && !stopping; i++)
      if (!(await deliverNotification())) break;
    if (Date.now() - lastReminder > 60000) {
      await queueReminders();
      lastReminder = Date.now();
    }
  } catch {
    logger.error("Worker tick failed; durable jobs remain retryable");
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
await db.$disconnect();
