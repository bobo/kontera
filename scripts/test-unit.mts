/**
 * Fast offline unit tests for pure domain logic (no DB, no LLM, no network).
 *
 *   npm run test:unit
 *
 * Scope: the deterministic core where a bug would corrupt the books or silently
 * mis-route an extraction — the assembler, the arithmetic self-check gate, FX
 * conversion, and the amount parser. Pure formatters (Intl wrappers) are left
 * untested on purpose: testing them would test the platform, not our logic.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleJournalEntry,
  proposableStatus,
} from "../src/lib/journal/assemble.ts";
import {
  detectBookkeepingConcerns,
  selfCheckInvoice,
} from "../src/lib/extract/self-check.ts";
import { convertInvoiceToSek, staticFxProvider } from "../src/lib/fx.ts";
import { parseSekToOre } from "../src/lib/money.ts";
import {
  PAYABLE_ACCOUNT,
  ROUNDING_DESCRIPTION,
  VAT_ACCOUNT,
} from "../src/lib/accounts.ts";
import type { AccountMapping, ExtractedInvoice } from "../src/lib/types.ts";

const EXPENSE = "5610"; // Kontorsmaterial — a valid line-mappable expense account.

/** A self-consistent invoice (lines = net, net + VAT = gross) to vary from. */
function invoice(over: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    currency: "SEK",
    lineItems: [{ lineNo: 1, description: "x", amountOre: 10000 }],
    netOre: 10000,
    vatOre: 2500,
    grossOre: 12500,
    ...over,
  };
}

function mapLines(
  ...specs: Array<[lineNo: number, konto: string]>
): AccountMapping {
  return {
    mappings: specs.map(([lineNo, konto]) => ({
      lineNo,
      konto,
      confidence: 0.9,
      reasoning: "test fixture",
    })),
  };
}

describe("assembleJournalEntry", () => {
  it("builds the standard supplier-invoice shape and balances", () => {
    const d = assembleJournalEntry(invoice(), mapLines([1, EXPENSE]));

    const expense = d.postings.filter((p) => p.sourceLineNo !== null);
    const vat = d.postings.find((p) => p.konto === VAT_ACCOUNT);
    const payable = d.postings.find((p) => p.konto === PAYABLE_ACCOUNT);

    assert.equal(expense.length, 1);
    assert.equal(expense[0].konto, EXPENSE, "uses the LLM-mapped account");
    assert.equal(expense[0].debitOre, 10000);
    assert.equal(vat?.debitOre, 2500);
    assert.equal(payable?.creditOre, 12500);
    assert.equal(d.balanced, true);
    assert.equal(d.totalDebitOre, d.totalCreditOre);
  });

  it("omits the VAT posting entirely when VAT is zero", () => {
    // A 0-VAT invoice must not produce a 0 kr input-VAT row.
    const d = assembleJournalEntry(
      invoice({ vatOre: 0, grossOre: 10000 }),
      mapLines([1, EXPENSE]),
    );
    assert.equal(
      d.postings.some((p) => p.konto === VAT_ACCOUNT),
      false,
    );
    assert.equal(d.postings.length, 2);
    assert.equal(d.balanced, true);
  });

  it("auto-posts a sub-krona gap as öresavrundning and balances", () => {
    // Supplier rounded the payable to the whole krona: debits run 1 öre ahead,
    // so a credit rounding line closes the gap. The adjustment is reported.
    const d = assembleJournalEntry(
      invoice({ grossOre: 12499 }),
      mapLines([1, EXPENSE]),
    );
    const rounding = d.postings.find(
      (p) => p.description === ROUNDING_DESCRIPTION,
    );
    assert.equal(d.balanced, true);
    assert.equal(d.roundingOre, 1);
    assert.equal(rounding?.creditOre, 1);
  });

  it("leaves a gap larger than öresavrundning unbalanced rather than auto-posting it", () => {
    // The safety boundary: a 1 kr discrepancy is a real error, not rounding, so
    // it is never silently absorbed — it stays unbalanced for human review.
    const d = assembleJournalEntry(
      invoice({ grossOre: 12400 }),
      mapLines([1, EXPENSE]),
    );
    assert.equal(d.balanced, false);
    assert.equal(d.roundingOre, 0);
    assert.equal(
      d.postings.some((p) => p.description === ROUNDING_DESCRIPTION),
      false,
    );
  });

  it("throws when a line item has no account mapping", () => {
    // A dropped mapping would silently under-book the entry; fail loudly instead.
    const inv = invoice({
      lineItems: [
        { lineNo: 1, description: "a", amountOre: 6000 },
        { lineNo: 2, description: "b", amountOre: 4000 },
      ],
    });
    assert.throws(
      () => assembleJournalEntry(inv, mapLines([1, EXPENSE])),
      /line item #2/,
    );
  });
});

describe("selfCheckInvoice (extraction trust gate)", () => {
  it("passes a self-consistent invoice with no warnings", () => {
    const r = selfCheckInvoice(invoice());
    assert.equal(r.ok, true);
    assert.equal(r.issues.filter((i) => i.severity === "warning").length, 0);
  });

  it("fails when line items do not sum to the stated net", () => {
    const r = selfCheckInvoice(
      invoice({ netOre: 9000, vatOre: 2500, grossOre: 11500 }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === "line_sum_mismatch"));
  });

  it("fails when net + VAT does not equal gross", () => {
    const r = selfCheckInvoice(invoice({ grossOre: 13000 }));
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === "totals_mismatch"));
  });

  it("treats a sub-krona discrepancy as info and stays ok", () => {
    // The boundary that pairs with ROUNDING_TOLERANCE_ORE: a good extraction
    // must not be bounced to the LLM fallback over 1 öre of rounding.
    const r = selfCheckInvoice(invoice({ grossOre: 12499 }));
    assert.equal(r.ok, true);
    assert.ok(
      r.issues.some(
        (i) => i.code === "totals_rounding" && i.severity === "info",
      ),
    );
  });

  it("warns when the stated VAT rate contradicts the amounts", () => {
    // 2500/10000 implies 25%, not the stated 6% — likely a misread.
    const r = selfCheckInvoice(invoice({ vatRate: 6 }));
    assert.ok(r.issues.some((i) => i.code === "vat_rate_mismatch"));
  });

  it("flags a non-positive gross (credit note or misread)", () => {
    const r = selfCheckInvoice(
      invoice({
        lineItems: [{ lineNo: 1, description: "refund", amountOre: -10000 }],
        netOre: -10000,
        vatOre: -2500,
        grossOre: -12500,
      }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === "nonpositive_total"));
  });
});

describe("convertInvoiceToSek", () => {
  it("returns the invoice untouched at rate 1 (SEK)", () => {
    const inv = invoice();
    assert.equal(convertInvoiceToSek(inv, 1), inv);
  });

  it("keeps the öre-exact invariants after a fractional-rate conversion", () => {
    // Net and gross are re-derived from the converted lines, so per-field
    // rounding can't drift them apart — the self-check still passes post-FX.
    const eur = invoice({
      currency: "EUR",
      lineItems: [
        { lineNo: 1, description: "a", amountOre: 3333 },
        { lineNo: 2, description: "b", amountOre: 3334 },
      ],
      netOre: 6667,
      vatOre: 1667,
      grossOre: 8334,
    });
    const sek = convertInvoiceToSek(eur, 11.3);

    assert.equal(
      sek.netOre,
      sek.lineItems.reduce((s, li) => s + li.amountOre, 0),
    );
    assert.equal(sek.grossOre, sek.netOre + sek.vatOre);
    assert.equal(selfCheckInvoice(sek).ok, true);
  });
});

describe("staticFxProvider", () => {
  it("looks up rates case-insensitively and returns null for unknown currencies", () => {
    // null is what flips fxResolved=false, keeping an unconvertible invoice
    //   out of the approvable state.
    assert.equal(staticFxProvider.rate("eur", null), 11.3);
    assert.equal(staticFxProvider.rate("GBP", null), null);
  });
});

describe("parseSekToOre (Swedish amount parsing)", () => {
  it("parses space thousands separator and decimal comma", () => {
    assert.equal(parseSekToOre("1 250,00"), 125000);
    assert.equal(parseSekToOre("50 000,00"), 5000000);
  });

  it("parses integers written without decimals", () => {
    assert.equal(parseSekToOre("1250"), 125000);
  });

  it("parses negative amounts (credit-note lines)", () => {
    assert.equal(parseSekToOre("-500,50"), -50050);
  });

  it("strips currency markers", () => {
    assert.equal(parseSekToOre("1 250,00 kr"), 125000);
    assert.equal(parseSekToOre("SEK 1 250,00"), 125000);
  });

  it("returns null for tokens that are not amounts", () => {
    assert.equal(parseSekToOre("Fakturanr"), null);
    assert.equal(parseSekToOre(""), null);
  });
});

describe("proposableStatus", () => {
  it("is approvable only when balanced AND in the booking currency", () => {
    assert.equal(proposableStatus(true, true), "proposed");
  });

  it("is not approvable when the foreign amounts could not be converted", () => {
    // Balancing in the original currency is meaningless; it must stay extracted.
    assert.equal(proposableStatus(true, false), "extracted");
  });

  it("is never approvable when unbalanced", () => {
    assert.equal(proposableStatus(false, true), "extracted");
    assert.equal(proposableStatus(false, false), "extracted");
  });
});

describe("detectBookkeepingConcerns", () => {
  it("flags a foreign 0-VAT invoice as suspected reverse charge (warning)", () => {
    const issues = detectBookkeepingConcerns(
      invoice({ currency: "EUR", vatOre: 0, grossOre: 10000 }),
      "EUR",
    );
    const flag = issues.find((i) => i.code === "reverse_charge_suspected");
    assert.ok(flag, "expected a reverse_charge_suspected flag");
    assert.equal(flag.severity, "warning");
  });

  it("treats a domestic 0-VAT invoice as a low-severity note", () => {
    const issues = detectBookkeepingConcerns(
      invoice({ currency: "SEK", vatOre: 0, grossOre: 10000 }),
      "SEK",
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "zero_vat");
    assert.equal(issues[0].severity, "info");
  });

  it("raises no concern for an ordinary VAT invoice", () => {
    assert.deepEqual(detectBookkeepingConcerns(invoice(), "SEK"), []);
  });
});
