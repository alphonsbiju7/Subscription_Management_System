DROP INDEX "Allocation_paymentId_invoiceId_key";
CREATE INDEX "Allocation_paymentId_invoiceId_idx" ON "Allocation"("paymentId", "invoiceId");
CREATE TRIGGER allocation_append_only BEFORE UPDATE OR DELETE ON "Allocation" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
