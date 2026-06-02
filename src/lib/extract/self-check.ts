import { ROUNDING_TOLERANCE_ORE } from "../money";
import type { ExtractedInvoice, SelfCheckResult, CheckIssue } from "../types";

/**
 * Verifies the extracted numbers are internally consistent. This runs on the
 * output of BOTH the deterministic parser and the LLM fallback — so whichever
 * produced the structure, the same arithmetic gate decides if it's trustworthy.
 *
 * `ok` means we can rely on the totals without human re-keying. It is NOT the
 * double-entry balance check (that happens later, in the journal assembler).
 */
export function selfCheckInvoice(inv: ExtractedInvoice): SelfCheckResult {
  const issues: CheckIssue[] = [];

  const lineSum = inv.lineItems.reduce((s, li) => s + li.amountOre, 0);

  if (inv.lineItems.length === 0) {
    issues.push({
      code: "no_line_items",
      message: "No line items were extracted.",
      severity: "warning",
    });
  } else {
    const diff = Math.abs(lineSum - inv.netOre);
    if (diff > ROUNDING_TOLERANCE_ORE) {
      issues.push({
        code: "line_sum_mismatch",
        message: `Line items sum to ${lineSum / 100} but net total is ${inv.netOre / 100}.`,
        severity: "warning",
      });
    } else if (diff > 0) {
      issues.push({
        code: "line_sum_rounding",
        message: `Line items sum to ${lineSum / 100}, net total is ${inv.netOre / 100} (within rounding).`,
        severity: "info",
      });
    }
  }

  const totalsDiff = Math.abs(inv.netOre + inv.vatOre - inv.grossOre);
  if (totalsDiff > ROUNDING_TOLERANCE_ORE) {
    issues.push({
      code: "totals_mismatch",
      message: `Net ${inv.netOre / 100} + VAT ${inv.vatOre / 100} ≠ gross ${inv.grossOre / 100}.`,
      severity: "warning",
    });
  } else if (totalsDiff > 0) {
    issues.push({
      code: "totals_rounding",
      message: `Net ${inv.netOre / 100} + VAT ${inv.vatOre / 100} vs gross ${inv.grossOre / 100} (öresavrundning).`,
      severity: "info",
    });
  }

  // Cross-check the implied VAT rate against any stated rate (advisory only).
  if (inv.netOre > 0 && inv.vatRate != null) {
    const impliedRate = (inv.vatOre / inv.netOre) * 100;
    if (Math.abs(impliedRate - inv.vatRate) > 0.5) {
      issues.push({
        code: "vat_rate_mismatch",
        message: `Stated VAT rate ${inv.vatRate}% but amounts imply ${impliedRate.toFixed(1)}%.`,
        severity: "warning",
      });
    }
  }

  if (inv.grossOre <= 0) {
    issues.push({
      code: "nonpositive_total",
      message: "Gross total is not positive — may be a credit note or misread.",
      severity: "warning",
    });
  }

  return { ok: issues.every((i) => i.severity !== "warning"), issues };
}

/**
 * Bookkeeping concerns that are arithmetically fine but accounting-wrong if
 * booked as-is. These are deliberately NOT part of `selfCheckInvoice`: they must
 * not flip its `ok` gate (which would discard a correct extraction and trigger
 * the LLM fallback). They are advisory flags for the accountant only.
 *
 * The headline case is reverse charge: an EU/foreign supplier invoice carries 0
 * VAT and therefore *balances* as an ordinary 0-VAT purchase — so nothing else
 * catches it. Booked that way it silently omits the self-assessed input/output
 * VAT pair (2640/2614). We surface it so the balanced-looking entry can't be
 * approved without a human deciding.
 */
export function detectBookkeepingConcerns(
  inv: ExtractedInvoice,
  originalCurrency: string,
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  if (inv.grossOre > 0 && inv.vatOre === 0) {
    const foreign = originalCurrency.toUpperCase() !== "SEK";
    issues.push(
      foreign
        ? {
            code: "reverse_charge_suspected",
            message:
              "Foreign-currency invoice with 0 VAT — likely EU reverse charge. No input VAT was booked; self-assessed VAT (2640/2614) may be required before posting.",
            severity: "warning",
          }
        : {
            code: "zero_vat",
            message:
              "0 VAT on a positive invoice — confirm it is genuinely VAT-exempt and not a reverse-charge purchase.",
            severity: "info",
          },
    );
  }

  return issues;
}
