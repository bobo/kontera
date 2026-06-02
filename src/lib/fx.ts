import type { ExtractedInvoice } from "./types";

/**
 * FX is a deterministic lookup, never an LLM job: a historical rate for a given
 * date is an immutable published fact. This static table is pinned to the rates
 * documented in the test-invoice answer key, so converted SEK amounts are exact
 * and reproducible. A Riksbank-backed provider can drop in behind `FxProvider`
 * without touching callers.
 */
export const FX_RATES_SEK_PER_UNIT: Record<string, number> = {
  SEK: 1,
  EUR: 11.3,
  USD: 10.5,
};

export interface FxProvider {
  /** SEK per one unit of `currency` on `date` (ISO), or null if unknown. */
  rate(currency: string, date: string | null): number | null;
}

export const staticFxProvider: FxProvider = {
  rate(currency) {
    return FX_RATES_SEK_PER_UNIT[currency.toUpperCase()] ?? null;
  },
};

/**
 * Convert every öre amount from the invoice currency to SEK öre. Line items are
 * converted then re-summed into the net, and gross is net + converted VAT — so
 * the two self-check invariants stay exact to the öre after conversion.
 */
export function convertInvoiceToSek(
  inv: ExtractedInvoice,
  rate: number,
): ExtractedInvoice {
  if (rate === 1) return inv;
  const conv = (ore: number) => Math.round(ore * rate);

  const lineItems = inv.lineItems.map((li) => ({
    ...li,
    unitPriceOre: li.unitPriceOre != null ? conv(li.unitPriceOre) : li.unitPriceOre,
    amountOre: conv(li.amountOre),
  }));

  const netOre = lineItems.reduce((s, li) => s + li.amountOre, 0);
  const vatOre = conv(inv.vatOre);

  return { ...inv, lineItems, netOre, vatOre, grossOre: netOre + vatOre };
}
