import "dotenv/config";
import { db } from "../apps/api/src/db.js";
import { saveGroqApiKey, getGroqApiKey } from "../apps/api/src/integrations/groq-credentials.js";

try {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Set GROQ_API_KEY temporarily, then run npm run chat:configure.");
  await saveGroqApiKey(key);
  if (await getGroqApiKey() !== key.trim()) throw new Error("Credential verification failed");
  console.log("Groq key saved and verified in encrypted database storage. Remove GROQ_API_KEY from your environment after setup.");
} finally {
  await db.$disconnect();
}
