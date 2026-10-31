-- Provider credentials live in a separate table so general settings APIs cannot expose them.
-- Values are encrypted by the application before insertion. No credentials are seeded here.
CREATE TABLE "IntegrationCredential" (
    "name" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("name")
);
