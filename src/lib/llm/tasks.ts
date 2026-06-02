import "server-only";
import { z } from "zod";
import { ACCOUNTS, EXPENSE_ACCOUNTS } from "../accounts";
import { formatOre } from "../money";
import {
  accountMappingSchema,
  enrichmentSchema,
  extractedInvoiceSchema,
  llmFlagsSchema,
  type AccountMapping,
  type Enrichment,
  type ExtractedInvoice,
  type LlmFlags,
} from "../types";
import { callStructured, type LlmCall } from "./client";

const CHART = ACCOUNTS.map((a) => `${a.konto}  ${a.namn}`).join("\n");
const EXPENSE_CHART = EXPENSE_ACCOUNTS.map(
  (a) => `${a.konto}  ${a.namn}`,
).join("\n");

function renderInvoice(inv: ExtractedInvoice): string {
  const lines = inv.lineItems
    .map((li) => `  #${li.lineNo}: "${li.description}" — ${formatOre(li.amountOre)} kr`)
    .join("\n");
  return [
    `Supplier: ${inv.supplierName ?? "?"}`,
    `Invoice: ${inv.invoiceNumber ?? "?"} (${inv.invoiceDate ?? "?"})`,
    `Line items:\n${lines}`,
    `Net: ${formatOre(inv.netOre)} | VAT: ${formatOre(inv.vatOre)} | Gross: ${formatOre(inv.grossOre)}`,
  ].join("\n");
}

/**
 * Map each line item to an expense account. The schema constrains `konto` to
 * the expense-account enum, so the model cannot return a structural or invented
 * account — that's enforced at the boundary, not trusted from the prompt.
 */
export async function mapAccounts(
  inv: ExtractedInvoice,
): Promise<LlmCall<AccountMapping>> {
  return callStructured({
    schema: accountMappingSchema,
    toolName: "submit_account_mapping",
    toolDescription:
      "Submit the chosen expense account for every invoice line item.",
    system: [
      "You are a Swedish accountant assistant working with the BAS chart of accounts.",
      "Map each invoice line item to the single most appropriate EXPENSE account.",
      "Choose only from these accounts:",
      EXPENSE_CHART,
      "",
      "For each line return: the account (konto), a confidence in [0,1], and a",
      "one-sentence reasoning for why that account fits.",
      "Rules: pick exactly one account per line item, by lineNo. Do not perform",
      "any arithmetic — amounts are handled by the system, not by you.",
    ].join("\n"),
    content: [{ type: "text", text: renderInvoice(inv) }],
  });
}

export async function enrichInvoice(
  inv: ExtractedInvoice,
): Promise<LlmCall<Enrichment>> {
  return callStructured({
    schema: enrichmentSchema,
    toolName: "submit_enrichment",
    toolDescription:
      "Submit semantic metadata about the invoice for search and grouping.",
    system: [
      "You enrich supplier invoices with metadata for later search and grouping.",
      "Produce: a one-sentence summary, 3-7 short lowercase tags, a category,",
      "a normalized supplier name, whether the cost is one-off or recurring,",
      "and the service period (periodStart/periodEnd as YYYY-MM-DD) if stated.",
      "This metadata is non-authoritative; it never changes the accounting.",
    ].join("\n"),
    content: [{ type: "text", text: renderInvoice(inv) }],
  });
}

/**
 * Advisory plausibility review. Produces warnings the accountant sees — it is
 * NEVER a gate. It must not check arithmetic (the system already does that
 * exactly); it only judges semantic sense.
 */
export async function reviewPlausibility(
  inv: ExtractedInvoice,
  mapping: AccountMapping,
): Promise<LlmCall<LlmFlags>> {
  const mapText = mapping.mappings
    .map((m) => `  #${m.lineNo} -> ${m.konto}`)
    .join("\n");
  return callStructured({
    schema: llmFlagsSchema,
    toolName: "submit_flags",
    toolDescription: "Submit advisory plausibility flags for the accountant.",
    system: [
      "You sanity-check a proposed journal entry for an accountant.",
      "Flag only SEMANTIC concerns, e.g.: a line mapped to an implausible",
      "account, the document not looking like a normal purchase invoice, a",
      "possible duplicate, or an unusual VAT situation.",
      "",
      "Do NOT check arithmetic or whether debits balance — the system verifies",
      "that exactly. Return an empty list if nothing looks off. These are",
      "advisory only and never block the entry.",
      "",
      "Chart of accounts:",
      CHART,
    ].join("\n"),
    content: [
      { type: "text", text: `${renderInvoice(inv)}\n\nProposed mapping:\n${mapText}` },
    ],
  });
}

// The model returns decimal SEK; converting to öre is done deterministically
// here so the model never has to multiply by 100.
const llmExtractionSchema = z.object({
  supplierName: z.string().nullable().optional(),
  supplierOrgNr: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  currency: z.string().default("SEK"),
  lineItems: z.array(
    z.object({
      lineNo: z.number().int(),
      description: z.string().min(1),
      quantity: z.number().nullable().optional(),
      unitPrice: z.number().nullable().optional(),
      amount: z.number(),
    }),
  ),
  net: z.number(),
  vat: z.number(),
  gross: z.number(),
  vatRate: z.number().nullable().optional(),
});

const toOre = (sek: number) => Math.round(sek * 100);

/**
 * Fallback extraction from the PDF document itself, used only when the
 * deterministic text-layer parser fails (e.g. a scanned invoice). The result
 * is still run through the same arithmetic self-check downstream — the LLM is
 * a structure-of-last-resort, never an authority on the numbers.
 */
export async function extractWithLlm(
  pdfBase64: string,
): Promise<LlmCall<ExtractedInvoice>> {
  const call = await callStructured({
    schema: llmExtractionSchema,
    toolName: "submit_invoice",
    toolDescription: "Submit the structured data read from the invoice PDF.",
    system: [
      "Extract structured data from this supplier invoice PDF.",
      "Report amounts as decimal numbers in the invoice currency (e.g. 1250.00).",
      "Transcribe values exactly as printed; never invent or compute totals.",
      "If a value is absent, use null.",
    ].join("\n"),
    content: [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
      },
      { type: "text", text: "Extract the invoice." },
    ],
    maxTokens: 4096,
  });

  const d = call.data;
  const invoice: ExtractedInvoice = extractedInvoiceSchema.parse({
    supplierName: d.supplierName ?? null,
    supplierOrgNr: d.supplierOrgNr ?? null,
    invoiceNumber: d.invoiceNumber ?? null,
    invoiceDate: d.invoiceDate ?? null,
    dueDate: d.dueDate ?? null,
    currency: d.currency,
    lineItems: d.lineItems.map((li) => ({
      lineNo: li.lineNo,
      description: li.description,
      quantity: li.quantity ?? null,
      unitPriceOre: li.unitPrice != null ? toOre(li.unitPrice) : null,
      amountOre: toOre(li.amount),
    })),
    netOre: toOre(d.net),
    vatOre: toOre(d.vat),
    grossOre: toOre(d.gross),
    vatRate: d.vatRate ?? null,
  });

  return { ...call, data: invoice };
}
