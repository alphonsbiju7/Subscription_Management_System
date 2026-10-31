CREATE TYPE "DemoPaymentMethod" AS ENUM ('UPI', 'CARD', 'NET_BANKING');
CREATE TYPE "DemoPaymentOutcome" AS ENUM ('SUCCESS', 'FAILURE');
CREATE TYPE "PaymentRecoveryStatus" AS ENUM ('PENDING', 'RECOVERED', 'EXHAUSTED');

CREATE TABLE "PaymentRecovery" (
    "id" TEXT PRIMARY KEY,
    "invoiceId" TEXT NOT NULL UNIQUE REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "status" "PaymentRecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "method" "DemoPaymentMethod" NOT NULL,
    "retryOutcome" "DemoPaymentOutcome" NOT NULL DEFAULT 'SUCCESS',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryDays" INTEGER[] NOT NULL DEFAULT ARRAY[1,3,5]::INTEGER[],
    "nextRetryAt" TIMESTAMP(3),
    "lastFailure" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT recovery_retry_bounds CHECK ("retryCount" >= 0 AND "retryCount" <= cardinality("retryDays") AND cardinality("retryDays") BETWEEN 1 AND 5 AND 0 < ALL("retryDays")),
    CONSTRAINT recovery_schedule CHECK ((status = 'PENDING' AND "nextRetryAt" IS NOT NULL AND "resolvedAt" IS NULL AND "retryCount" < cardinality("retryDays")) OR (status = 'RECOVERED' AND "nextRetryAt" IS NULL AND "resolvedAt" IS NOT NULL) OR (status = 'EXHAUSTED' AND "nextRetryAt" IS NULL AND "resolvedAt" IS NULL))
);
CREATE INDEX "PaymentRecovery_status_nextRetryAt_idx" ON "PaymentRecovery"("status", "nextRetryAt");

CREATE TABLE "DemoPaymentAttempt" (
    "id" TEXT PRIMARY KEY,
    "invoiceId" TEXT NOT NULL REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "recoveryId" TEXT REFERENCES "PaymentRecovery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "paymentId" TEXT UNIQUE REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "transactionReference" TEXT NOT NULL UNIQUE,
    "method" "DemoPaymentMethod" NOT NULL,
    "outcome" "DemoPaymentOutcome" NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "failureReason" TEXT,
    "retryNumber" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT demo_attempt_amount CHECK (amount > 0 AND "retryNumber" >= 0),
    CONSTRAINT demo_attempt_result CHECK ((outcome = 'SUCCESS' AND "paymentId" IS NOT NULL AND "failureReason" IS NULL) OR (outcome = 'FAILURE' AND "paymentId" IS NULL AND "failureReason" IS NOT NULL)),
    CONSTRAINT demo_attempt_reference CHECK ("transactionReference" LIKE 'DEMO-%')
);
CREATE INDEX "DemoPaymentAttempt_invoiceId_createdAt_idx" ON "DemoPaymentAttempt"("invoiceId", "createdAt");
CREATE INDEX "DemoPaymentAttempt_recoveryId_createdAt_idx" ON "DemoPaymentAttempt"("recoveryId", "createdAt");
CREATE INDEX "DemoPaymentAttempt_outcome_createdAt_idx" ON "DemoPaymentAttempt"("outcome", "createdAt");
CREATE TRIGGER demo_attempt_append_only BEFORE UPDATE OR DELETE ON "DemoPaymentAttempt" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
