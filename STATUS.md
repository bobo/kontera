# Status snapshot — 2026-06-02

Point-in-time state for the live interview. Architecture/design lives in
[README.md](./README.md); this is "where things stand and what's next."

## Done & verified

- **End-to-end on `simple_invoice.pdf`**: extraction → mapping
  (6530 / 6530 / 6540) → **balanced** entry (D = C = 116 875) → persisted →
  approve/decline. Verified via the API and in a real browser.
- **Kontera frontend** (ported from the Claude Design handoff): full SPA flow
  Upload → Processing → Review (rendered bill + editable journal entry, per-line
  confidence + rationale, live Balanserad ✓, advisory flags, tags) → Done.
  EN/SV language toggle. Calm-Scandinavian design system in `globals.css`.
- **Editable mapping**: re-map accounts / edit amounts / add-remove postings;
  saved via `PUT /entry` as a new immutable revision behind the balance gate +
  optimistic-lock (a stale approve after an edit correctly 409s).
- **3-layer pipeline**: deterministic extraction → LLM judgment (mapping,
  enrichment, advisory flags) → deterministic assembly + balance gate.
- **Optimistic concurrency**: approve/decline are version-conditional;
  stale → 409 conflict, already-decided → 409 wrong_status. Verified.
- **Deterministic FX** (EUR/USD → SEK, pinned static rates): converted SEK
  matches the answer key for #02 (1036,21), #03 (5040), #08 (9520,82).
- **Production build** passes; `tsc --noEmit` clean.
- **Test harness**: `npm run test:invoices` (`--extract-only`, id filter).

## Test-invoice baseline

Deterministic extraction (`--extract-only`, all 12, free/offline):

| # | Edge case | Extraction state |
|---|-----------|------------------|
| 01 | mixed VAT 25/12 | gross right; VAT under-read (single-rate assumption) → self-check flags |
| 02 | reverse charge EUR | ✅ parsed, currency EUR, foreign gross ok |
| 03 | reverse charge USD (paid) | ✅ parsed, currency USD |
| 04 | öresavrundning + telecom | line-sum / totals mismatch (rounding line) |
| 05 | VAT-inclusive receipt | parser bails (no VAT-column labels) → LLM fallback |
| 06 | credit note (negative) | flagged nonpositive_total |
| 07 | multi-page, 17 lines | only 6 lines parsed (page-2 / layout) |
| 08 | advertising, no account, EUR | ✅ parsed, EUR |
| 09 | insurance VAT-exempt | ✅ parsed (net = gross, 0 VAT) |
| 10 | payment reminder | parser bails (no totals labels) → LLM fallback |
| 11 | reduced 6% + food | ✅ parsed |
| 12 | scanned image | no text layer → LLM fallback (correct) |

Full LLM pipeline: verified on #02/#03/#08 (FX). **Full 12-invoice LLM run not
yet executed** — run `npm run test:invoices` for the complete baseline.

## Known gaps = live-interview targets

1. **Reverse charge** (#02/#03/#08): self-assess input VAT (2640) + output VAT
   (2614, off-chart); don't book invoice VAT of 0 as final.
2. **Paid-by-card** (#03): credit side is 1930, not 2440.
3. **Credit notes** (#06): detected but signs not handled.
4. **Mixed / derived VAT** (#01 two rates, #04 rounding, #05 inclusive
   back-calc): extraction reads a single VAT total.
5. **Multi-page aggregation** (#07): page-2 line items dropped.
6. **Food-VAT date rule** (#11): 12% → 6% from 2026-04-01.
7. **Scanned OCR path** (#12): verified end-to-end — text-layer returns nothing,
   the LLM-vision fallback extracts KONTORSBODEN AB / 3 839,50 and balances
   (5610 + 7631 + 2640 + 2440). (Fixing this surfaced a detached-ArrayBuffer bug:
   pdfjs was consuming the bytes the fallback needed — now extraction copies.)

Upload failures now return a typed code (`not_pdf`, `empty_file`,
`extraction_failed`, `ai_auth`, `ai_unavailable`, `processing_failed`) and the UI
shows a specific localized message per code.

## Run

```bash
npm install
cp .env.example .env.local   # set ANTHROPIC_API_KEY
npm run db:push
npm run dev                  # http://localhost:3000
```
