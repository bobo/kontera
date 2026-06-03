/**
 * Money is represented as integer öre (1/100 SEK) everywhere. No floats touch
 * an amount — this is what makes the deterministic balance check exact.
 */

/**
 * Sub-krona slack treated as genuine öresavrundning rather than a misread.
 * Swedish invoices round the payable total to the whole krona, so a gap up to
 * 50 öre is legitimate rounding. Shared by the extraction self-check (below this
 * → info, not a warning) and the journal assembler (below this → auto-posted).
 */
export const ROUNDING_TOLERANCE_ORE = 50;

/** Parse a Swedish-formatted amount ("50 000,00", "1 250,00", "-500,50") to öre. */
export function parseSekToOre(raw: string): number | null {
  const cleaned = raw
    .replace(/ /g, " ")
    .replace(/SEK/gi, "")
    .replace(/kr/gi, "")
    .trim();

  // Swedish format: space (or thin space) as thousands sep, comma as decimal.
  const normalized = cleaned.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatOre(ore: number): string {
  const sek = ore / 100;
  return new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(sek);
}

export function formatSek(ore: number): string {
  return `${formatOre(ore)} kr`;
}
