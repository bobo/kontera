# Hard test invoices — where we stand

Status of the pipeline against the `interview/test-invoices/` library, run with
`npm run test:invoices` (full pipeline, ~40 real LLM calls, a couple of minutes).
"Pass" = the core structural checks: **balanced**, **SEK gross matches** the
answer key (FX-converted), and **all in-chart expected accounts present**.

**4 / 12 pass.** The 8 that don't are almost all *accounting features we chose
not to build*, not parsing failures — the harness pinpoints each. Severity:

- ✅ **Works** — #01, #04, #09, #12
- 🟡 **Balances & totals right; only account-choice / missing reverse-charge VAT** — #02, #03, #07, #08, #11
- 🔴 **Wrong output (unbalanced or wrong total)** — #05, #06, #10

| # | Edge case | Result | Core issue |
|---|-----------|--------|------------|
| 01 | Mixed VAT 25/12 | ✅ pass | — (vision fallback read it; one combined 2640) |
| 02 | Reverse charge, EUR | 🟡 | no self-assessed VAT (2640 + 2614) |
| 03 | Reverse charge, USD, paid by card | 🟡 | no reverse-charge VAT; credit side should be 1930 |
| 04 | Öresavrundning + telecom split | ✅ pass | — |
| 05 | VAT-inclusive receipt, paid by card | 🔴 | **unbalanced** — VAT not back-calculated from gross |
| 06 | Credit note (negative) | 🔴 | **unbalanced** — signs not flipped |
| 07 | Multi-page, 17 lines, freight | 🟡 | balances; freight not mapped to 5690 |
| 08 | Advertising (no account) + reverse charge, EUR | 🟡 | ad → 6910 not 5690; no reverse-charge VAT |
| 09 | Insurance, VAT-exempt | ✅ pass | — (correctly NOT treated as reverse charge) |
| 10 | Payment reminder | 🔴 | **re-books the original 116 875**; fees mis-mapped |
| 11 | Reduced 6% (books) + 2026 food-VAT change | 🟡 | balances; books → 4010 not 5610 |
| 12 | Scanned image, no text layer | ✅ pass | — (vision fallback) |

---

## What works today

- **Deterministic extraction + LLM mapping + balance gate** on clean single-rate
  SEK invoices (#01 effectively, #09).
- **Vision fallback** for scanned / no-text-layer PDFs (#12, and #01/#04 fell back
  cleanly when their text-layer self-check failed).
- **FX → SEK** conversion at pinned rates (#02/#03/#08 all gross-match in SEK).
- **VAT-exempt ≠ reverse charge** (#09): a 0 %-VAT insurance invoice is booked in
  full to 6310 with no input VAT — we do *not* over-trigger reverse-charge logic.
- **Mixed VAT rates** collapse into one 2640 posting (#01), as the answer key wants.

## What each unsolved case needs

### 🔴 Correctness issues (produce a wrong/blocked entry)

- **#05 VAT-inclusive pricing** — prices include 25 % VAT and there's no VAT column,
  so net/VAT aren't split and the entry comes out **unbalanced**.
  *Needs:* detect inclusive pricing → back-calculate `net = gross / 1.25`,
  `vat = gross − net`. (Also: "paid by card" → credit **1930**, not 2440.)
- **#06 Credit note** — all amounts negative ("Kreditfaktura"). We don't detect it,
  so the entry is **unbalanced**.
  *Needs:* detect credit note → flip every posting (credit the expense / 2640,
  debit 2440), or carry signed amounts through the balance gate.
- **#10 Payment reminder** — we **re-book the original 116 875 kr** invoice (gross
  comes out 117 754 vs the expected 879). Only the *new* charges are postable.
  *Needs:* detect a reminder/påminnelse document → ignore the restated original;
  book only påminnelseavgift (**5690**, no good in-chart account — 6990 is correct
  but absent) and dröjsmålsränta (**8420**, off-chart) — both VAT-free. (See the
  reminder-fee research note.)

### 🟡 Reverse charge (balances and totals are right, VAT booking is incomplete)

- **#02 / #03 / #08** — EU/foreign supplier, 0 % VAT on the invoice. We book VAT as
  shown (i.e. none) so the entry balances, but we skip the self-assessment.
  *Needs:* detect reverse charge (0 % VAT + foreign VAT id / "reverse charge" text)
  → add **2640** input VAT *and* **2614** output VAT (equal, net-zero). 2614 isn't
  in the provided chart, so this also needs a chart extension or an explicit
  "off-chart account required" flag. #03 additionally needs **paid-by-card → 1930**;
  #08 additionally needs advertising → **5690** + low-confidence (not 6910).

### 🟡 Account-choice nuance (balanced, gross correct, just a debatable mapping)

- **#07 freight** → expected **5690** (no freight account in the chart); the LLM put
  it elsewhere. Multi-page aggregation otherwise works (all 17 lines read).
- **#11 books** → expected **5610/6910**; the LLM chose **4010**. The 6 % VAT and the
  2026 food-VAT-date rule didn't break the totals (VAT read from the invoice), but a
  date-aware VAT model would make this robust rather than incidental.

## Cross-cutting capabilities that would move the needle

Roughly in priority order for "solve the most cases":

1. **Document-type detection** (normal invoice / credit note / reminder / receipt) —
   unlocks #05, #06, #10. This is the single highest-leverage addition.
2. **Reverse-charge handling** + a 2614 account (chart extension or off-chart flag) —
   unlocks #02, #03, #08.
3. **Payment-status detection** (paid by card → 1930) — #03, #05.
4. **VAT-derivation modes** (inclusive back-calc; date-aware reduced rates) — #05, #11.
5. **Mapping hints** for fallback accounts (freight/advertising → 5690 + low
   confidence) — #07, #08.

None of these are parsing problems — extraction (text-layer + vision) and the
balance gate are solid. The gaps are accounting rules, which is the right place for
the next iteration (and good live-interview material).
