# Invoice → Journal Entry

Upload a Swedish supplier invoice (PDF). The app extracts it, proposes a balanced
double-entry **journal entry** mapped to the BAS chart of accounts, and lets an
accountant **approve or decline** it.

## Core design principle: the LLM never owns a number

Numbers and balancing are deterministic; the LLM is used only for judgment.
Three layers:

1. **Deterministic extraction** (`src/lib/extract`) — `pdfjs-dist` reads the PDF's
   text layer with token coordinates, reconstructs rows, and parses line items and
   totals. A **math self-check** then verifies the extraction is internally
   consistent (`Σ line items = net`, `net + VAT = gross`). No model is involved, so
   there is nothing to hallucinate — the values are literally the bytes in the PDF.

2. **LLM for judgment only** (`src/lib/llm`) — Claude does the genuinely fuzzy work:
   - **Account mapping** — picks a BAS expense account per line item. The response
     is constrained to a `zod` enum of the valid expense codes, so a hallucinated or
     structural account fails validation *at the boundary* rather than later.
   - **Enrichment** — non-authoritative tags / summary / category / period for
     search and grouping.
   - **Advisory plausibility review** — flags semantic concerns (odd mapping, looks
     like a credit note, possible duplicate). It is explicitly told **not** to check
     arithmetic, and its flags **never block** — the human decides.

3. **Deterministic assembly + balance gate** (`src/lib/journal`) — builds the
   postings (expense debits + `2640` input VAT debit + `2440` supplier credit),
   computes totals, and **refuses to persist an entry unless debits = credits**.

If the text layer is missing (a scan) or the self-check fails, extraction falls
back to Claude's PDF document input — but the **same self-check re-validates** that
output, so the LLM is a structure-of-last-resort, never an authority on the values.

All money is integer **öre** end to end; no floats touch an amount.

**Foreign currency** is converted to SEK by a deterministic `FxProvider`
(`src/lib/fx.ts`) — a rate lookup + multiplication in code, never the LLM (a
historical rate is an immutable fact). The default static table is pinned to known
rates; a Riksbank-backed provider can drop in behind the same interface. The rate
used is stored on the invoice for reproducibility.

## Data model (`src/db/schema.ts`)

- **Immutable + append-only.** A journal entry is never edited; approve/decline
  appends a `status_transitions` row. Raw LLM I/O is stored in `llm_runs` for replay.
- **Optimistic concurrency.** `invoices.version` is the concurrency token. Approve
  /decline are conditional writes on the version the client last reviewed — a stale
  or already-decided entry returns **409**, so an accountant can only sign off on the
  exact version they saw.
- **Authoritative vs advisory.** Deterministic checks are a hard gate (block persist);
  LLM flags are advisory metadata.

## Run locally

Requires Node 20.9+ (tested on 23).

```bash
npm install
cp .env.example .env.local   # then set ANTHROPIC_API_KEY
npm run db:push              # create the SQLite schema (./data/app.db)
npm run dev                  # http://localhost:3000
```

Upload `simple_invoice.pdf`, review the proposed entry, and approve/decline.

## Environment

| Variable            | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY` | Account mapping, enrichment, validation.    |
| `DATABASE_URL`      | SQLite file path (default `./data/app.db`). |

## API

| Method | Route                       | Purpose                                   |
| ------ | --------------------------- | ----------------------------------------- |
| `POST` | `/api/invoices`             | Upload PDF → run pipeline → persist.       |
| `GET`  | `/api/invoices`             | List invoices.                             |
| `GET`  | `/api/invoices/:id`         | Full detail (entry, flags, tags, audit).   |
| `GET`  | `/api/invoices/:id/pdf`     | The original bill.                         |
| `POST` | `/api/invoices/:id/approve` | `{ expectedVersion }` → 200 / 409.         |
| `POST` | `/api/invoices/:id/decline` | `{ expectedVersion, note? }` → 200 / 409.  |
| `PUT`  | `/api/invoices/:id/entry`   | Save an edited entry as a new revision; balance-gated, version-bumped → 200 / 409 / 422. |

## Interface

The frontend ("Kontera") is a single-page flow — Upload → Processing → Review →
Done — ported from a Claude Design handoff into React/TS (`src/components/kontera`,
design system in `globals.css`). The Review screen shows the rendered bill beside
the editable journal entry, with per-line **confidence** + "why this account"
rationale, a live **Balanserad ✓** indicator, advisory flags, tags, and an EN/SV
toggle. Editing (re-map account, change amounts, add/remove postings) recomputes
the balance live and saves through the balance-gated `PUT /entry`.

## Stack

Next.js 16 (App Router, TypeScript) · SQLite + Drizzle · `@anthropic-ai/sdk`
(Claude Sonnet) · `pdfjs-dist` · `zod`.

## Testing against the hard-invoice library

`npm run test:invoices` runs the pipeline over the `test-invoices` library and
compares **structurally** to its answer key (`expected.json`): does the entry
balance, does the SEK gross match (FX converted at the pinned rate), which
accounts / flags came out vs expected. It asserts on structure, not naive öre
hard-equality, per the library's own caveats.

```bash
npm run test:invoices                    # full pipeline (calls the LLM)
npm run test:invoices -- --extract-only  # deterministic extraction only (free, offline)
npm run test:invoices -- 02,07           # only these ids
```

## Dev scripts

```bash
# Inspect deterministic extraction on a PDF
npx tsx scripts/test-extract.mts [path-to.pdf]
# Exercise the LLM mapping / enrichment / flags (needs ANTHROPIC_API_KEY)
node --conditions=react-server --import tsx --env-file=.env.local scripts/test-llm.mts
```

## Known gaps (surfaced by the test harness)

- **Reverse charge** (EU/foreign supplier, 0% VAT) is not yet self-assessed — the
  app books VAT as shown rather than generating the input (2640) + output (2614)
  VAT pair. 2614 isn't in the provided chart either.
- **Credit notes** (negative amounts) are flagged but not sign-handled.
- VAT is taken from the invoice's stated totals; mixed-rate invoices balance but
  the per-rate split isn't itemized.
- No auth / multi-user; the optimistic-lock plumbing is there but "who approved" is
  not captured.
- **Concurrency & double-booking are only lightly guarded.** Optimistic locking
  (`invoices.version`) keeps two reviewers from acting on a stale version of *one*
  invoice, but two further safeguards a real financial system would want are absent:
  (1) it does nothing to stop the *same* invoice being uploaded and booked twice —
  that needs duplicate detection / idempotency (e.g. dedupe on supplier org-nr +
  invoice number + gross, or an upload idempotency key); and (2) the version checks
  aren't stress-tested under genuine concurrent access. Hardening both is the natural
  extension and good practice for accounting software — though for a single-user,
  single-process local tool it's arguably more rigor than this scope needs.
- SQLite + local disk for PDFs keeps "run locally" to two commands.
