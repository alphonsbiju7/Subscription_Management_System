import { Router } from "express";
import PDFDocument from "pdfkit";
import { db } from "../db.js";
import { own } from "../access.js";
import { check } from "../errors.js";
import {
  calculateBill,
  D,
  money,
  sum,
  type BillInput,
} from "../../../../packages/billing-engine/src/index.js";
import type { Contract } from "./sales.js";
export const documents = Router();
function header(doc: PDFKit.PDFDocument, title: string, number: string) {
  doc.rect(0, 0, 595, 100).fill("#101c32");
  doc.fillColor("#77e6c5").fontSize(24).text("brightloop", 45, 28);
  doc.fillColor("white").fontSize(10).text("SUBSCRIPTION OS", 45, 60);
  doc.fontSize(18).text(title, 340, 31, { width: 210, align: "right" });
  doc.fontSize(9).text(number, 340, 60, { width: 210, align: "right" });
  doc.fillColor("#17263b").fontSize(10);
  doc.y = 125;
}
function rows(
  doc: PDFKit.PDFDocument,
  lines: { description: string; quantity: string; total: string }[],
  currency: string,
) {
  for (const line of lines) {
    if (doc.y > 690) doc.addPage();
    const y = doc.y;
    doc.font("Helvetica-Bold").text(line.description, 45, y, { width: 350 });
    doc.font("Helvetica").text(`${line.quantity} units`, 45, doc.y + 3);
    doc.text(`${currency} ${line.total}`, 415, y, {
      width: 135,
      align: "right",
    });
    doc
      .moveTo(45, doc.y + 22)
      .lineTo(550, doc.y + 22)
      .strokeColor("#e2e8f0")
      .stroke();
    doc.y += 40;
  }
}
documents.get("/invoices/:id/pdf", async (req, res) => {
  const invoice = await db.invoice.findUnique({
    where: { id: String(req.params.id) },
    include: { lines: true, period: true, allocations: true },
  });
  check(invoice, "Invoice not found", 404);
  own(req.actor, invoice.customerId);
  const snapshot = invoice.snapshot as {
    customer: {
      name: string;
      email: string;
      company: string;
      billingAddress: string;
      taxId: string;
    };
    input: BillInput;
  };
  const doc = new PDFDocument({
    size: "A4",
    margin: 45,
    info: { Title: invoice.number, Author: "Brightloop Software" },
  });
  res
    .type("pdf")
    .setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.number}.pdf"`,
    );
  doc.pipe(res);
  header(
    doc,
    invoice.status === "DRAFT" ? "DRAFT INVOICE" : "INVOICE",
    invoice.number,
  );
  doc.font("Helvetica-Bold").text("BILL TO");
  doc
    .moveDown(0.5)
    .font("Helvetica")
    .text(snapshot.customer.name)
    .text(snapshot.customer.company)
    .text(snapshot.customer.email)
    .text(snapshot.customer.billingAddress)
    .text(`Tax registration: ${snapshot.customer.taxId || "Not supplied"}`);
  doc
    .moveDown()
    .text(
      `Issued: ${invoice.issuedAt.toISOString().slice(0, 10)}     Due: ${invoice.dueAt.toISOString().slice(0, 10)}`,
    )
    .text(
      `Service: ${invoice.period.startAt.toISOString().slice(0, 10)} to ${invoice.period.endAt.toISOString().slice(0, 10)} (exclusive)`,
    );
  doc.moveDown(2);
  rows(
    doc,
    invoice.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity.toString(),
      total: l.total.toFixed(2),
    })),
    invoice.currency,
  );
  if (doc.y > 570) doc.addPage();
  const expected = calculateBill(snapshot.input);
  for (const text of [
    `Subtotal: ${invoice.subtotal.toFixed(2)}`,
    `Discount: -${invoice.discountTotal.toFixed(2)}`,
    `Tax: ${invoice.taxTotal.toFixed(2)}`,
    ...expected.lines.flatMap((l) =>
      l.components.map((c) => `${c.name} (${c.rate}%): ${c.amount}`),
    ),
    `Credits: -${invoice.creditTotal.toFixed(2)}`,
    `Total: ${invoice.currency} ${invoice.total.toFixed(2)}`,
    `Paid: ${money(sum(invoice.allocations.map((a) => a.amount.toString())))}`,
    `Outstanding: ${money(D(invoice.total.toString()).minus(sum(invoice.allocations.map((a) => a.amount.toString()))))}`,
  ])
    doc.text(text, { align: "right" });
  doc
    .moveDown(2)
    .fontSize(8)
    .fillColor("#64748b")
    .text(
      "Brightloop Software · Generated from the immutable billing snapshot. Illustrative tax treatment; not a certification of jurisdictional compliance.",
    );
  doc.end();
});
documents.get("/quotes/:id/pdf", async (req, res) => {
  const quote = await db.quote.findUnique({
    where: { id: String(req.params.id) },
    include: { customer: true, lines: true, discount: true },
  });
  check(quote, "Quotation not found", 404);
  own(req.actor, quote.customerId);
  const discount = quote.discount;
  const calculated = calculateBill({
    at: quote.createdAt.toISOString(),
    taxExempt: quote.customer.taxExempt,
    lines: quote.lines.map((l) => {
      const c = l.snapshot as unknown as Contract;
      return {
        description: l.description,
        model: c.model,
        quantity: String(l.quantity),
        unitPrice: l.unitPrice.toString(),
        tiers: c.tiers,
        packageSize: c.packageSize,
        extra: D(c.setupFee).plus(c.addonCharge).toString(),
        tax: c.tax,
        discountEligible:
          !discount?.productId || discount.productId === c.productId,
      };
    }),
    discount: discount
      ? {
          ...discount,
          value: discount.value.toString(),
          minimum: discount.minimum.toString(),
          startsAt: discount.startsAt.toISOString(),
          endsAt: discount.endsAt.toISOString(),
        }
      : null,
  });
  const doc = new PDFDocument({ size: "A4", margin: 45 });
  res
    .type("pdf")
    .setHeader("Content-Disposition", `inline; filename="${quote.number}.pdf"`);
  doc.pipe(res);
  header(doc, "QUOTATION", quote.number);
  doc
    .text(`${quote.customer.name}\n${quote.customer.email}`)
    .moveDown()
    .text(`Status: ${quote.status} · Revision ${quote.revision}`)
    .text(`Valid until: ${quote.validUntil.toISOString().slice(0, 10)}`)
    .moveDown(2);
  rows(doc, calculated.lines, quote.currency);
  doc
    .font("Helvetica-Bold")
    .text(`Estimated initial total: ${quote.currency} ${calculated.total}`, {
      align: "right",
    });
  doc.moveDown().font("Helvetica").fontSize(9).text(quote.terms);
  doc.end();
});
