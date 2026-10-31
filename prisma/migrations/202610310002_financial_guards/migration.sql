ALTER TABLE "Product" ADD CONSTRAINT product_nonnegative CHECK ("salesPrice" >= 0 AND "costPrice" >= 0);
ALTER TABLE "PlanVersion" ADD CONSTRAINT plan_nonnegative CHECK (price >= 0 AND "setupFee" >= 0 AND "usageRate" >= 0 AND "includedUsage" >= 0 AND "minQuantity">0 AND "packageSize">0);
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_nonnegative CHECK (total >= 0 AND "creditTotal" >= 0 AND "discountTotal" >= 0 AND "taxTotal" >= 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT line_nonnegative CHECK (quantity >= 0 AND "unitPrice" >= 0 AND total >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT payment_positive CHECK (amount > 0);
ALTER TABLE "Allocation" ADD CONSTRAINT allocation_positive CHECK (amount > 0);
ALTER TABLE "CreditEntry" ADD CONSTRAINT credit_positive CHECK (amount > 0);
ALTER TABLE "CreditApplication" ADD CONSTRAINT credit_application_positive CHECK (amount > 0);
ALTER TABLE "Adjustment" ADD CONSTRAINT adjustment_positive CHECK (amount > 0);
ALTER TABLE "UsageEvent" ADD CONSTRAINT usage_positive CHECK (quantity > 0);
ALTER TABLE "Discount" ADD CONSTRAINT discount_valid CHECK (value >= 0 AND (type != 'PERCENT' OR value <= 100) AND used >= 0 AND ("usageLimit" IS NULL OR used <= "usageLimit") AND "endsAt">"startsAt");
ALTER TABLE "BillingPeriod" ADD CONSTRAINT period_valid CHECK ("endAt">"startAt");
ALTER TABLE "SubscriptionItem" ADD CONSTRAINT subscription_quantity_positive CHECK (quantity > 0 AND "unitPrice" >= 0);
ALTER TABLE "QuoteLine" ADD CONSTRAINT quote_quantity_positive CHECK (quantity > 0 AND "unitPrice" >= 0);
ALTER TABLE "Customer" ADD CONSTRAINT terms_nonnegative CHECK ("paymentTerms" >= 0);
ALTER TABLE "User" ADD CONSTRAINT normalized_email CHECK (email = lower(trim(email)));

CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only financial or audit record'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER credit_append_only BEFORE UPDATE OR DELETE ON "CreditEntry" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER credit_application_append_only BEFORE UPDATE OR DELETE ON "CreditApplication" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER payment_append_only BEFORE UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER period_append_only BEFORE UPDATE OR DELETE ON "BillingPeriod" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER plan_version_append_only BEFORE UPDATE OR DELETE ON "PlanVersion" FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE FUNCTION protect_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'CONFIRMED' OR OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Issued financial documents are immutable; create a credit note';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION protect_invoice();
CREATE FUNCTION protect_invoice_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
  SELECT status::text INTO state FROM "Invoice" WHERE id=OLD."invoiceId";
  IF state != 'DRAFT' THEN RAISE EXCEPTION 'Issued invoice lines are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_line_immutable BEFORE UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION protect_invoice_line();
CREATE FUNCTION protect_accepted_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='ACCEPTED' THEN RAISE EXCEPTION 'Accepted offers are immutable; create a revision'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quote_immutable BEFORE UPDATE OR DELETE ON "Quote" FOR EACH ROW EXECUTE FUNCTION protect_accepted_quote();
CREATE FUNCTION protect_quote_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
  SELECT status::text INTO state FROM "Quote" WHERE id=OLD."quoteId";
  IF state != 'DRAFT' THEN RAISE EXCEPTION 'Sent quotation lines are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER quote_line_immutable BEFORE UPDATE OR DELETE ON "QuoteLine" FOR EACH ROW EXECUTE FUNCTION protect_quote_line();
CREATE FUNCTION protect_approved_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status != 'REQUESTED' THEN RAISE EXCEPTION 'Decided adjustments are immutable'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Adjustments cannot be deleted'; END IF;
  IF NEW."requestedBy"=NEW."approvedBy" THEN RAISE EXCEPTION 'Maker and checker must differ'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER adjustment_immutable BEFORE UPDATE OR DELETE ON "Adjustment" FOR EACH ROW EXECUTE FUNCTION protect_approved_adjustment();
