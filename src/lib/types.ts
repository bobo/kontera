import { z } from "zod";
import { EXPENSE_KONTO_CODES } from "./accounts";

/** A single extracted invoice row. Amounts in integer öre. */
export const lineItemSchema = z.object({
  lineNo: z.number().int(),
  description: z.string().min(1),
  quantity: z.number().nullable().optional(),
  unitPriceOre: z.number().int().nullable().optional(),
  amountOre: z.number().int(),
});
export type ExtractedLineItem = z.infer<typeof lineItemSchema>;

/** Structured invoice facts. All money in öre; no floats. */
export const extractedInvoiceSchema = z.object({
  supplierName: z.string().nullable().optional(),
  supplierOrgNr: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().default("SEK"),
  lineItems: z.array(lineItemSchema),
  netOre: z.number().int(),
  vatOre: z.number().int(),
  grossOre: z.number().int(),
  vatRate: z.number().nullable().optional(),
});
export type ExtractedInvoice = z.infer<typeof extractedInvoiceSchema>;

export type Severity = "info" | "warning";

export interface CheckIssue {
  code: string;
  message: string;
  severity: Severity;
}

export interface SelfCheckResult {
  ok: boolean;
  issues: CheckIssue[];
}

export type ExtractionMethod = "text-layer" | "llm-vision";

export interface ExtractionResult {
  method: ExtractionMethod;
  invoice: ExtractedInvoice;
  rawText: string;
  selfCheck: SelfCheckResult;
}

/**
 * The LLM's account mapping is constrained to the expense-account enum, so a
 * hallucinated account fails validation at the boundary rather than later.
 */
export const accountMappingSchema = z.object({
  mappings: z.array(
    z.object({
      lineNo: z.number().int(),
      konto: z.enum(EXPENSE_KONTO_CODES),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    }),
  ),
});
export type AccountMapping = z.infer<typeof accountMappingSchema>;

export const enrichmentSchema = z.object({
  summary: z.string(),
  tags: z.array(z.string()),
  category: z.string(),
  supplierNormalized: z.string().nullable().optional(),
  costType: z.enum(["one-off", "recurring"]).nullable().optional(),
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
});
export type Enrichment = z.infer<typeof enrichmentSchema>;

export const llmFlagsSchema = z.object({
  flags: z.array(
    z.object({
      severity: z.enum(["info", "warning"]),
      code: z.string(),
      message: z.string(),
    }),
  ),
});
export type LlmFlags = z.infer<typeof llmFlagsSchema>;
