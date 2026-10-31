ALTER TABLE "Adjustment" ADD COLUMN "invoiceId" TEXT;
ALTER TABLE "Adjustment" ADD CONSTRAINT "Adjustment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
