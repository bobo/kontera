import { parseSekToOre } from "../money";
import type { ExtractedInvoice, ExtractedLineItem } from "../types";

interface Token {
  str: string;
  x: number;
  y: number;
}
interface Row {
  y: number;
  tokens: Token[];
}

/**
 * Deterministic extraction from a PDF's embedded text layer. No model involved:
 * the values returned are literally the bytes in the PDF, reconstructed into
 * rows via token coordinates. Returns null if the PDF has no usable text layer
 * (e.g. a scan) — the caller then falls back to the LLM document path.
 */
export async function extractFromTextLayer(
  data: Uint8Array,
): Promise<{ invoice: ExtractedInvoice; rawText: string } | null> {
  const tokens = await readTokens(data);
  if (tokens.length < 5) return null;

  const rows = groupRows(tokens);
  const rawText = rows
    .map((r) => r.tokens.map((t) => t.str).join(" "))
    .join("\n");

  const numeric = tokens.filter((t) => parseSekToOre(t.str) !== null);

  const netOre = findValueForLabel(rows, numeric, /exkl\.?\s*moms|netto/i);
  const vatOre = findValueForLabel(rows, numeric, /^moms\b|moms\s*\d/i, /exkl/i);
  const grossOre =
    findValueForLabel(rows, numeric, /att\s*betala/i) ??
    findValueForLabel(rows, numeric, /totalt|summa\s*att/i);

  const vatRate = matchVatRate(rawText);
  const lineItems = parseLineItems(rows);

  // Derive any missing total from the other two rather than guessing.
  const net = netOre ?? (grossOre != null && vatOre != null ? grossOre - vatOre : null);
  const vat = vatOre ?? (grossOre != null && net != null ? grossOre - net : null);
  const gross = grossOre ?? (net != null && vat != null ? net + vat : null);

  if (net == null || vat == null || gross == null) return null;

  return {
    rawText,
    invoice: {
      supplierName: guessSupplier(rawText),
      supplierOrgNr: matchFirst(rawText, /\b(\d{6}-\d{4})\b/),
      invoiceNumber: matchFirst(rawText, /fakturanr\D*(\w+)/i),
      invoiceDate: matchFirst(rawText, /fakturadatum\D*(\d{4}-\d{2}-\d{2})/i),
      dueDate: matchFirst(
        rawText,
        /(?:förfallodatum|forfallodatum)\D*(\d{4}-\d{2}-\d{2})/i,
      ),
      currency: detectCurrency(rawText),
      lineItems,
      netOre: net,
      vatOre: vat,
      grossOre: gross,
      vatRate,
    },
  };
}

async function readTokens(data: Uint8Array): Promise<Token[]> {
  // Legacy build is the Node-compatible entry point for pdfjs-dist.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdfjs detaches the ArrayBuffer it's given; hand it a copy so callers (e.g.
  // the LLM fallback) can still read the original bytes afterwards.
  const loadingTask = pdfjs.getDocument({
    data: data.slice(),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const tokens: Token[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageOffset = (p - 1) * 10000; // keep pages vertically separated
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      tokens.push({
        str: item.str,
        x: item.transform[4],
        y: pageOffset + item.transform[5],
      });
    }
  }
  await loadingTask.destroy();
  return tokens;
}

function groupRows(tokens: Token[], tol = 3): Row[] {
  const sorted = [...tokens].sort((a, b) => b.y - a.y);
  const rows: Row[] = [];
  for (const t of sorted) {
    const row = rows.find((r) => Math.abs(r.y - t.y) <= tol);
    if (row) row.tokens.push(t);
    else rows.push({ y: t.y, tokens: [t] });
  }
  for (const r of rows) r.tokens.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Find the numeric value belonging to a label. Swedish invoices align the
 * value either to the right of the label (same row) or directly beneath it
 * (next row, same column) — so we score candidates by column proximity plus a
 * small penalty for vertical distance, and take the best.
 */
function findValueForLabel(
  rows: Row[],
  numeric: Token[],
  label: RegExp,
  exclude?: RegExp,
): number | null {
  let labelTok: Token | null = null;
  for (const r of rows) {
    for (const t of r.tokens) {
      if (label.test(t.str) && !(exclude && exclude.test(t.str))) {
        labelTok = t;
        break;
      }
    }
    if (labelTok) break;
  }
  if (!labelTok) return null;

  let best: { tok: Token; cost: number } | null = null;
  for (const n of numeric) {
    const dy = labelTok.y - n.y; // positive => value is below label
    const sameRowRight = Math.abs(dy) <= 3 && n.x > labelTok.x;
    const below = dy > 0 && dy < 45;
    if (!sameRowRight && !below) continue;
    const cost = Math.abs(n.x - labelTok.x) + (below ? dy : 0);
    if (!best || cost < best.cost) best = { tok: n, cost };
  }
  return best ? parseSekToOre(best.tok.str) : null;
}

function parseLineItems(rows: Row[]): ExtractedLineItem[] {
  const headerIdx = rows.findIndex((r) =>
    /benämning|benamning|beskrivning|artikel|text|specifikation/i.test(
      r.tokens.map((t) => t.str).join(" "),
    ),
  );
  if (headerIdx === -1) return [];

  const items: ExtractedLineItem[] = [];
  let lineNo = 1;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const text = row.tokens.map((t) => t.str).join(" ");
    if (/exkl\.?\s*moms|netto|^moms|totalt|att\s*betala/i.test(text)) break;

    const sorted = [...row.tokens].sort((a, b) => a.x - b.x);
    // A leading pure-integer in the leftmost column is the article/line number,
    // not a money column — set it aside so it can't be read as quantity.
    if (sorted.length && /^\d+$/.test(sorted[0].str)) sorted.shift();

    const nums = sorted.filter((t) => parseSekToOre(t.str) !== null);
    if (nums.length === 0) continue;

    // Columns are right-anchored: amount | unit price | quantity.
    const amountTok = nums[nums.length - 1];
    const amountOre = parseSekToOre(amountTok.str);
    if (amountOre == null) continue;

    const description = sorted
      .filter((t) => t.x < amountTok.x && parseSekToOre(t.str) === null)
      .map((t) => t.str)
      .join(" ")
      .trim();
    if (!description) continue;

    const unitPriceOre =
      nums.length >= 2 ? parseSekToOre(nums[nums.length - 2].str) : null;
    const quantity =
      nums.length >= 3
        ? (parseSekToOre(nums[nums.length - 3].str) ?? 0) / 100
        : null;

    items.push({ lineNo: lineNo++, description, quantity, unitPriceOre, amountOre });
  }
  return items;
}

function detectCurrency(text: string): string {
  const valuta = text.match(/valuta\s+([A-Z]{3})/i);
  if (valuta) return valuta[1].toUpperCase();
  if (/\bEUR\b|€/.test(text)) return "EUR";
  if (/\bUSD\b/.test(text)) return "USD";
  return "SEK";
}

function matchVatRate(text: string): number | null {
  const m = text.match(/moms\s*(\d{1,2})\s*%/i);
  return m ? Number(m[1]) : null;
}

function matchFirst(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? (m[1] ?? m[0]).trim() : null;
}

const AB_NAME = /([A-ZÅÄÖ][\wÅÄÖåäö&.\- ]+?\bAB)\b/;

function guessSupplier(text: string): string | null {
  // The supplier (invoice issuer) is the party tied to the org number — its
  // legal name sits on the same line. The customer's "... AB" appears earlier
  // in the address block, so anchoring on the org-nr line avoids picking it.
  const orgLine = text
    .split("\n")
    .find((l) => /\b\d{6}-\d{4}\b/.test(l) && AB_NAME.test(l));
  if (orgLine) return orgLine.match(AB_NAME)![1].trim();

  const all = [...text.matchAll(new RegExp(AB_NAME, "g"))];
  return all.length ? all[all.length - 1][1].trim() : null;
}
