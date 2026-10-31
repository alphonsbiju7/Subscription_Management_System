import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { findUnique, upsert } = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("../../apps/api/src/db.js", () => ({ db: { integrationCredential: { findUnique, upsert } } }));
vi.mock("../../apps/api/src/config.js", () => ({ config: { BETTER_AUTH_SECRET: "test-only-credential-encryption-secret-2026" } }));
import { getGroqApiKey, saveGroqApiKey } from "../../apps/api/src/integrations/groq-credentials.js";
import { decrypt } from "../../apps/api/src/crypto.js";

const sample = "test-only-provider-credential-not-a-live-key";
beforeEach(() => { findUnique.mockReset(); upsert.mockReset(); upsert.mockResolvedValue({}); });

describe("encrypted provider credential storage", () => {
  it("stores ciphertext in a separate credential table and reads the key back", async () => {
    await saveGroqApiKey(sample);
    const write = upsert.mock.calls[0]?.[0];
    expect(write.where).toEqual({ name: "groq" });
    expect(write.create.encryptedValue).not.toContain(sample);
    expect(decrypt(write.create.encryptedValue)).toBe(sample);
    expect(write.update.encryptedValue).toBe(write.create.encryptedValue);
    findUnique.mockResolvedValueOnce(write.create);
    expect(await getGroqApiKey()).toBe(sample);
  });
  it("uses fresh authenticated ciphertext when rotating the same key", async () => {
    await saveGroqApiKey(sample);
    await saveGroqApiKey(sample);
    expect(upsert.mock.calls[0]?.[0].create.encryptedValue).not.toBe(upsert.mock.calls[1]?.[0].create.encryptedValue);
  });
  it("does not write missing/invalid keys and handles unconfigured storage", async () => {
    await expect(saveGroqApiKey(" ")).rejects.toBeInstanceOf(z.ZodError);
    expect(upsert).not.toHaveBeenCalled();
    findUnique.mockResolvedValueOnce(null);
    expect(await getGroqApiKey()).toBeUndefined();
  });
  it("returns a safe configuration error for corrupted or unreadable ciphertext", async () => {
    findUnique.mockResolvedValueOnce({ encryptedValue: "private-unreadable-ciphertext" });
    await expect(getGroqApiKey()).rejects.toMatchObject({ status: 503, message: "The assistant credential needs to be configured again." });
  });
});
