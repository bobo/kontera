import { z } from "zod";

/**
 * The API response contract, shared across the network boundary. The server
 * parses its output through these schemas before responding (guaranteeing the
 * shape and stripping server-only fields like rawText / timestamps); the client
 * parses what it receives. One definition, both sides — no hand-kept mirror.
 *
 * This module imports only zod, so it is safe to use from client components.
 */

export const invoiceViewSchema = z.object({
  id: z.string(),
  status: z.enum(["extracted", "proposed", "approved", "declined"]),
  version: z.number(),
  supplierName: z.string().nullable(),
  supplierOrgNr: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.string(),
  fxRate: z.number(),
  netOre: z.number(),
  vatOre: z.number(),
  grossOre: z.number(),
  vatRate: z.number().nullable(),
  extractionMethod: z.string(),
});
export type InvoiceView = z.infer<typeof invoiceViewSchema>;

export const lineItemViewSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  description: z.string(),
  quantity: z.number().nullable(),
  unitPriceOre: z.number().nullable(),
  amountOre: z.number(),
});
export type LineItemView = z.infer<typeof lineItemViewSchema>;

export const journalEntryViewSchema = z.object({
  id: z.string(),
  revision: z.number(),
  balanced: z.boolean(),
  totalDebitOre: z.number(),
  totalCreditOre: z.number(),
});
export type JournalEntryView = z.infer<typeof journalEntryViewSchema>;

export const postingViewSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  konto: z.string(),
  kontoNamn: z.string(),
  debitOre: z.number(),
  creditOre: z.number(),
  description: z.string().nullable(),
  sourceLineItemId: z.string().nullable(),
  confidence: z.number().nullable(),
  rationale: z.string().nullable(),
});
export type PostingView = z.infer<typeof postingViewSchema>;

export const flagViewSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "warning"]),
  source: z.enum(["deterministic", "llm"]),
  code: z.string(),
  message: z.string(),
});
export type FlagView = z.infer<typeof flagViewSchema>;

export const enrichmentViewSchema = z.object({
  summary: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  category: z.string().nullable(),
});
export type EnrichmentView = z.infer<typeof enrichmentViewSchema>;

export const invoiceDetailSchema = z.object({
  invoice: invoiceViewSchema,
  lineItems: z.array(lineItemViewSchema),
  journalEntry: journalEntryViewSchema.nullable(),
  postings: z.array(postingViewSchema),
  enrichment: enrichmentViewSchema.nullable(),
  flags: z.array(flagViewSchema),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const invoiceSummarySchema = z.object({
  id: z.string(),
  status: z.enum(["extracted", "proposed", "approved", "declined"]),
  supplierName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  grossOre: z.number(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

export const invoiceSummaryListSchema = z.array(invoiceSummarySchema);
