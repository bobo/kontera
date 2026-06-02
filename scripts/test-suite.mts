/**
 * Regression harness for the hard test-invoice library.
 *
 * Runs the pipeline over every PDF and compares STRUCTURALLY to expected.json:
 * does the entry balance, does the gross match (for non-FX invoices), and which
 * accounts / flags came out vs expected. Per the library's CAVEATS we do not
 * hard-compare amounts on FX invoices or demand accounts the chart can't express.
 *
 *   npm run test:invoices                 # full pipeline (calls the LLM)
 *   npm run test:invoices -- --extract-only   # deterministic extraction only (free)
 *   npm run test:invoices -- 02,07        # only these ids
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractFromTextLayer } from "../src/lib/extract/text-layer.ts";
import { selfCheckInvoice } from "../src/lib/extract/self-check.ts";
import { ACCOUNT_BY_KONTO } from "../src/lib/accounts.ts";
import { formatOre } from "../src/lib/money.ts";

const ROOT = "./test-invoices";
const PDF_DIR = join(ROOT, "pdf");

const args = process.argv.slice(2);
const extractOnly = args.includes("--extract-only");
const idFilter = args.find((a) => !a.startsWith("--"));
const onlyIds = idFilter ? new Set(idFilter.split(",")) : null;

const toOre = (sek: number) => Math.round(sek * 100);
const C = {
  pass: (s: string) => `\x1b[32m${s}\x1b[0m`,
  fail: (s: string) => `\x1b[31m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

interface Expected {
  id: string;
  file: string;
  currency: string;
  fx_rate_to_sek: number | null;
  invoice_total: number;
  accounts_outside_provided_chart: string[] | null;
  review_flags: string[];
  notes: string;
  journal_entry: { account: string; debit: number; credit: number }[];
}

const key = JSON.parse(readFileSync(join(ROOT, "expected.json"), "utf8"));
const expected: Expected[] = key.invoices;

// Lazy import of the LLM pipeline so --extract-only needs no API key.
const runPipeline = extractOnly
  ? null
  : (await import("../src/lib/pipeline.ts")).runPipeline;

interface Row {
  id: string;
  edge: string;
  ok: boolean;
  cells: string[];
  notes: string[];
}

const rows: Row[] = [];

for (const exp of expected) {
  if (onlyIds && !onlyIds.has(exp.id)) continue;
  const pdfPath = join(PDF_DIR, exp.file);
  const edge = exp.notes.slice(0, 40);
  if (!existsSync(pdfPath)) {
    rows.push({ id: exp.id, edge, ok: false, cells: ["missing pdf"], notes: [] });
    continue;
  }

  const bytes = new Uint8Array(readFileSync(pdfPath));
  const rate = exp.fx_rate_to_sek ?? 1;
  // Extraction reports amounts in the invoice currency; the pipeline converts
  // to SEK, so the two modes compare against different expected totals.
  const expForeignOre = toOre(exp.invoice_total);
  const expSekOre = toOre(exp.invoice_total * rate);
  const notes: string[] = [];

  try {
    if (extractOnly) {
      const res = await extractFromTextLayer(bytes);
      if (!res) {
        rows.push({
          id: exp.id,
          edge,
          ok: true,
          cells: [C.warn("no text layer → LLM fallback")],
          notes: ["scanned/!text — expected for #12"],
        });
        continue;
      }
      const check = selfCheckInvoice(res.invoice);
      const grossMatch = res.invoice.grossOre === expForeignOre;
      rows.push({
        id: exp.id,
        edge,
        ok: check.ok && grossMatch,
        cells: [
          `text-layer ${res.invoice.currency}`,
          check.ok ? C.pass("self-check ok") : C.warn("self-check issues"),
          `gross ${formatOre(res.invoice.grossOre)}${grossMatch ? "" : C.warn(` ≠ ${formatOre(expForeignOre)}`)}`,
          `${res.invoice.lineItems.length} lines`,
        ],
        notes: check.issues.map((i) => i.code),
      });
      continue;
    }

    // --- full pipeline ---
    const r = await runPipeline!(new Uint8Array(bytes));
    const chosen = new Set(r.journal.postings.map((p) => p.konto));
    const expInChart = exp.journal_entry
      .map((p) => p.account)
      .filter((a) => ACCOUNT_BY_KONTO[a]);
    const missing = expInChart.filter((a) => !chosen.has(a));
    const extra = [...chosen].filter(
      (a) => !exp.journal_entry.some((p) => p.account === a),
    );

    const balanced = r.journal.balanced;
    // FX is now deterministic, so compare the converted SEK gross directly.
    const grossOk = r.invoice.grossOre === expSekOre;

    if (!balanced) notes.push("UNBALANCED");
    if (!grossOk) notes.push(`gross ${formatOre(r.invoice.grossOre)} vs ${formatOre(expSekOre)} SEK`);
    if (rate !== 1) notes.push(C.dim(`${r.originalCurrency}@${r.fxRate}`));
    if (missing.length) notes.push(`missing acct ${missing.join(",")}`);
    if (extra.length) notes.push(`extra acct ${extra.join(",")}`);
    if (exp.accounts_outside_provided_chart?.length)
      notes.push(C.dim(`needs off-chart ${exp.accounts_outside_provided_chart.join(",")}`));
    if (exp.review_flags.length)
      notes.push(C.dim(`expects flags: ${exp.review_flags.join(",")} (got ${r.flags.flags.length})`));

    rows.push({
      id: exp.id,
      edge,
      ok: balanced && grossOk && missing.length === 0,
      cells: [
        r.method,
        balanced ? C.pass("balanced") : C.fail("UNBALANCED"),
        grossOk ? C.pass("gross ok") : C.fail("gross ✗"),
        missing.length === 0 ? C.pass("accts ok") : C.warn(`miss ${missing.length}`),
        `${r.flags.flags.length} flags`,
      ],
      notes,
    });
  } catch (err) {
    rows.push({
      id: exp.id,
      edge,
      ok: false,
      cells: [C.fail("ERROR")],
      notes: [err instanceof Error ? err.message : String(err)],
    });
  }
}

// --- report ---
console.log(`\n${extractOnly ? "EXTRACTION-ONLY" : "FULL PIPELINE"} — ${rows.length} invoices\n`);
for (const r of rows) {
  const mark = r.ok ? C.pass("✓") : C.fail("✗");
  console.log(`${mark} #${r.id}  ${C.dim(r.edge)}`);
  console.log(`    ${r.cells.join("  ·  ")}`);
  if (r.notes.length) console.log(`    ${C.dim(r.notes.join(" | "))}`);
}
const passed = rows.filter((r) => r.ok).length;
console.log(`\n${passed}/${rows.length} passed core structural checks.\n`);
