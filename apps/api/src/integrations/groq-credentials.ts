import { z } from "zod";
import { db } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { ApiError } from "../errors.js";

const keyInput = z.string().trim().min(20).max(512);

export async function saveGroqApiKey(value: string) {
  const encryptedValue = encrypt(keyInput.parse(value));
  await db.integrationCredential.upsert({
    where: { name: "groq" },
    create: { name: "groq", encryptedValue },
    update: { encryptedValue },
  });
}

export async function getGroqApiKey(): Promise<string | undefined> {
  const credential = await db.integrationCredential.findUnique({ where: { name: "groq" } });
  if (!credential) return undefined;
  try {
    return keyInput.parse(decrypt(credential.encryptedValue));
  } catch {
    throw new ApiError(503, "The assistant credential needs to be configured again.");
  }
}
