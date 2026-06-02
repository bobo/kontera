import {
  ACCOUNT_BY_KONTO,
  PAYABLE_ACCOUNT,
  ROUNDING_ACCOUNT,
  ROUNDING_DESCRIPTION,
  VAT_ACCOUNT,
} from "../accounts";
import { ROUNDING_TOLERANCE_ORE } from "../money";
import type { AccountMapping, ExtractedInvoice } from "../types";
import type { InvoiceStatus } from "../../db/schema";

/**
 * Decide whether a freshly extracted entry is approvable.
 *
 * An entry is only `proposed` (approvable) when it both balances AND its amounts
 * are in the booking currency. A balanced entry whose foreign amounts could not
 * be converted to SEK (no FX rate available) is NOT trustworthy — balancing in
 * the wrong currency is meaningless — so it stays `extracted` until an edit or a
 * resolved rate brings it into a real, SEK-denominated balance.
 */
export function proposableStatus(
  balanced: boolean,
  fxResolved: boolean,
): InvoiceStatus {
  return balanced && fxResolved ? "proposed" : "extracted";
}

export interface PostingDraft {
  konto: string;
  kontoNamn: string;
  debitOre: number;
  creditOre: number;
  description: string | null;
  /** The invoice line this posting came from; null for structural postings. */
  sourceLineNo: number | null;
  /** LLM mapping confidence [0,1]; null for structural postings. */
  confidence: number | null;
  /** LLM "why this account" rationale; null for structural postings. */
  rationale: string | null;
}

export interface JournalDraft {
  postings: PostingDraft[];
  totalDebitOre: number;
  totalCreditOre: number;
  balanced: boolean;
  /**
   * Signed öre auto-posted as öresavrundning to close a sub-krona gap (0 if
   * none). Positive = a credit adjustment was added (debits ran ahead). Surfaced
   * to the accountant as an advisory flag — never silent.
   */
  roundingOre: number;
}

/**
 * Build the double-entry journal entry deterministically from extracted facts
 * and the LLM's account mapping. Standard incoming supplier-invoice shape:
 *
 *   Debit  <expense account>  net amount   (one per line item)
 *   Debit  2640 Ingående moms  VAT amount
 *   Credit 2440 Leverantörsskulder  gross amount
 *
 * The LLM only supplied the expense account per line. Every amount here comes
 * from the deterministic extraction, and the balance is computed and checked in
 * code — the model never touches it.
 */
export function assembleJournalEntry(
  inv: ExtractedInvoice,
  mapping: AccountMapping,
): JournalDraft {
  const byLine = new Map(mapping.mappings.map((m) => [m.lineNo, m]));
  const postings: PostingDraft[] = [];

  for (const li of inv.lineItems) {
    const m = byLine.get(li.lineNo);
    if (!m) {
      throw new Error(`No account mapping for line item #${li.lineNo}`);
    }
    const account = ACCOUNT_BY_KONTO[m.konto];
    if (!account) throw new Error(`Unknown account ${m.konto}`);

    postings.push({
      konto: account.konto,
      kontoNamn: account.namn,
      debitOre: li.amountOre,
      creditOre: 0,
      description: li.description,
      sourceLineNo: li.lineNo,
      confidence: m.confidence,
      rationale: m.reasoning,
    });
  }

  if (inv.vatOre > 0) {
    const vat = ACCOUNT_BY_KONTO[VAT_ACCOUNT];
    postings.push({
      konto: vat.konto,
      kontoNamn: vat.namn,
      debitOre: inv.vatOre,
      creditOre: 0,
      description: "Ingående moms",
      sourceLineNo: null,
      confidence: null,
      rationale: null,
    });
  }

  const payable = ACCOUNT_BY_KONTO[PAYABLE_ACCOUNT];
  postings.push({
    konto: payable.konto,
    kontoNamn: payable.namn,
    debitOre: 0,
    creditOre: inv.grossOre,
    description: inv.supplierName ?? "Leverantörsskuld",
    sourceLineNo: null,
    confidence: null,
    rationale: null,
  });

  const debitBeforeRounding = postings.reduce((s, p) => s + p.debitOre, 0);
  const creditBeforeRounding = postings.reduce((s, p) => s + p.creditOre, 0);

  // Close a genuine öresavrundning gap automatically: the supplier rounded the
  // payable total to the whole krona, so a sub-krona difference is rounding, not
  // a misread. Anything larger is left unbalanced for human review. The amount
  // is pure arithmetic (gross is fixed), so code owns it — same as every other
  // number here. The adjustment is flagged downstream, never silent.
  const gap = debitBeforeRounding - creditBeforeRounding;
  let roundingOre = 0;
  if (gap !== 0 && Math.abs(gap) <= ROUNDING_TOLERANCE_ORE) {
    const rounding = ACCOUNT_BY_KONTO[ROUNDING_ACCOUNT];
    roundingOre = gap;
    postings.push({
      konto: rounding.konto,
      kontoNamn: rounding.namn,
      // gap = debit − credit: debits ahead → balance with a credit, and vice versa.
      debitOre: gap < 0 ? -gap : 0,
      creditOre: gap > 0 ? gap : 0,
      description: ROUNDING_DESCRIPTION,
      sourceLineNo: null,
      confidence: null,
      rationale: null,
    });
  }

  const totalDebitOre = postings.reduce((s, p) => s + p.debitOre, 0);
  const totalCreditOre = postings.reduce((s, p) => s + p.creditOre, 0);

  return {
    postings,
    totalDebitOre,
    totalCreditOre,
    balanced: totalDebitOre === totalCreditOre,
    roundingOre,
  };
}
