import "server-only";
import { extractFromTextLayer } from "./extract/text-layer";
import { detectBookkeepingConcerns, selfCheckInvoice } from "./extract/self-check";
import { convertInvoiceToSek, staticFxProvider, type FxProvider } from "./fx";
import { PipelineError } from "./errors";
import { assembleJournalEntry, type JournalDraft } from "./journal/assemble";
import {
  enrichInvoice,
  extractWithLlm,
  mapAccounts,
  reviewPlausibility,
} from "./llm/tasks";
import { MODEL } from "./llm/client";
import type {
  AccountMapping,
  CheckIssue,
  Enrichment,
  ExtractedInvoice,
  ExtractionMethod,
  LlmFlags,
  SelfCheckResult,
} from "./types";

export interface LlmRunRecord {
  purpose: "mapping" | "enrichment" | "validation" | "extraction";
  model: string;
  request: unknown;
  response: unknown;
  inputTokens: number;
  outputTokens: number;
}

export interface PipelineResult {
  invoice: ExtractedInvoice;
  rawText: string;
  method: ExtractionMethod;
  /** Original invoice currency before SEK conversion. */
  originalCurrency: string;
  /** SEK-per-unit rate applied (1 for SEK invoices). */
  fxRate: number;
  /** Whether the invoice is in (or was converted to) SEK. False means a foreign
   * invoice whose amounts are left unconverted — not approvable. */
  fxResolved: boolean;
  selfCheck: SelfCheckResult;
  /** Deterministic advisory flags that don't gate extraction (e.g. reverse charge). */
  bookkeepingFlags: CheckIssue[];
  mapping: AccountMapping;
  /** Null when the (non-authoritative) enrichment call failed — never fatal. */
  enrichment: Enrichment | null;
  flags: LlmFlags;
  journal: JournalDraft;
  llmRuns: LlmRunRecord[];
}

/**
 * Layer 1 → 2 → 3 in order:
 *   1. Deterministic text-layer extraction; fall back to the LLM document path
 *      only if there's no usable text layer or the math self-check fails. The
 *      same self-check then re-validates whatever the fallback produced.
 *   2. LLM account mapping + enrichment (parallel), then advisory review.
 *   3. Deterministic assembly + balance — code owns every number.
 */
export async function runPipeline(
  pdf: Uint8Array,
  fx: FxProvider = staticFxProvider,
): Promise<PipelineResult> {
  const llmRuns: LlmRunRecord[] = [];

  // --- Layer 1: extraction ---
  let method: ExtractionMethod = "text-layer";
  // A corrupt/odd PDF can make pdfjs throw — treat that as "no text layer" and
  // fall through to the LLM document path rather than failing outright.
  const extracted = await extractFromTextLayer(pdf).catch(() => null);
  let invoice = extracted?.invoice ?? null;
  let rawText = extracted?.rawText ?? "";
  let selfCheck = invoice
    ? selfCheckInvoice(invoice)
    : { ok: false, issues: [] };

  if (!invoice || !selfCheck.ok) {
    const base64 = Buffer.from(pdf).toString("base64");
    const llm = await extractWithLlm(base64);
    llmRuns.push({
      purpose: "extraction",
      model: MODEL,
      request: llm.raw.request,
      response: llm.raw.response,
      inputTokens: llm.usage.inputTokens,
      outputTokens: llm.usage.outputTokens,
    });
    method = "llm-vision";
    invoice = llm.data;
    rawText = rawText || JSON.stringify(llm.data, null, 2);
    selfCheck = selfCheckInvoice(invoice);
  }

  // Nothing usable came out of either extraction path — fail clearly rather
  // than mapping and persisting an empty invoice.
  if (invoice.lineItems.length === 0 && invoice.grossOre === 0) {
    throw new PipelineError(
      "extraction_failed",
      "No line items or totals could be read from the document",
    );
  }

  // --- FX: convert to SEK deterministically (the journal entry is in SEK) ---
  const originalCurrency = invoice.currency;
  let fxRate = 1;
  // A foreign invoice we couldn't convert is left in its own currency; its
  // amounts must not be treated as SEK, so it can't become approvable.
  let fxResolved = true;
  if (originalCurrency.toUpperCase() !== "SEK") {
    const rate = fx.rate(originalCurrency, invoice.invoiceDate ?? null);
    if (rate != null) {
      invoice = convertInvoiceToSek(invoice, rate);
      fxRate = rate;
      selfCheck = selfCheckInvoice(invoice);
    } else {
      fxResolved = false;
      selfCheck = {
        ok: false,
        issues: [
          ...selfCheck.issues,
          {
            code: "unknown_fx_rate",
            message: `No FX rate available for ${originalCurrency}; amounts left unconverted.`,
            severity: "warning",
          },
        ],
      };
    }
  }

  // Deterministic advisory flags computed on the resolved (SEK) invoice. Kept
  // out of `selfCheck` so they never flip its gate or trigger the LLM fallback.
  const bookkeepingFlags = detectBookkeepingConcerns(invoice, originalCurrency);

  // --- Layer 2: mapping (authoritative) + enrichment/review (advisory) ---
  // Mapping is required to assemble the entry, so its failure is fatal. Enrichment
  // and the plausibility review are non-authoritative — per the design they must
  // degrade (null enrichment / no flags) rather than fail the whole upload.
  const [mapCall, enrSettled] = await Promise.all([
    mapAccounts(invoice),
    settle(enrichInvoice(invoice)),
  ]);
  llmRuns.push(runRecord("mapping", mapCall));

  let enrichment: Enrichment | null = null;
  if (enrSettled.ok) {
    enrichment = enrSettled.value.data;
    llmRuns.push(runRecord("enrichment", enrSettled.value));
  } else {
    console.error("Enrichment failed (advisory, continuing):", enrSettled.error);
  }

  const flagSettled = await settle(reviewPlausibility(invoice, mapCall.data));
  let flags: LlmFlags = { flags: [] };
  if (flagSettled.ok) {
    flags = flagSettled.value.data;
    llmRuns.push(runRecord("validation", flagSettled.value));
  } else {
    console.error("Plausibility review failed (advisory, continuing):", flagSettled.error);
  }

  // --- Layer 3: deterministic assembly + balance ---
  const journal = assembleJournalEntry(invoice, mapCall.data);

  return {
    invoice,
    rawText,
    method,
    originalCurrency,
    fxRate,
    fxResolved,
    selfCheck,
    bookkeepingFlags,
    mapping: mapCall.data,
    enrichment,
    flags,
    journal,
    llmRuns,
  };
}

type Settled<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

/** Resolve a promise to a tagged result so an advisory call's failure is data,
 * not an exception that aborts the authoritative pipeline. */
function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

function runRecord(
  purpose: LlmRunRecord["purpose"],
  call: {
    raw: { request: unknown; response: unknown };
    usage: { inputTokens: number; outputTokens: number };
  },
): LlmRunRecord {
  return {
    purpose,
    model: MODEL,
    request: call.raw.request,
    response: call.raw.response,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
  };
}
