# Hard test invoices — invoice → journal-entry app

A set of synthetic Swedish invoices that stress the invoice-to-journal-entry
pipeline well past the clean `simple_invoice.pdf`. Each one targets a specific
parsing or accounting edge case. Use them to probe the candidate's app live,
or as regression fixtures.

PDFs live in [`pdf/`](./pdf). Regenerate everything with:

```bash
python3 generate.py        # writes build/*.html
./render.sh                # renders build/*.html -> pdf/*.pdf via headless Chrome
```

All companies, org-numbers, VAT-numbers, IBANs and amounts are **fictional**.
Amounts are arithmetically consistent (the generator computes the totals), so a
correct app should always produce a balancing journal entry.

## The Chart of Accounts (recap)

The provided BAS subset is deliberately small (20 accounts). Several invoices
below reference cost types that **have no good account** in this list — that is
the point. A good app should pick the least-wrong account (usually `5690 Övriga
kontorskostnader`) **and surface low confidence**, rather than silently
inventing or forcing a mapping.

Notably missing from the chart: freight/shipping, travel, advertising/
marketing, bank/interest costs (8xxx), output VAT (2614), and any rounding
account (3740). Watch how the app copes.

## Why these are hard

| # | File | Edge case | What a correct journal entry looks like |
|---|------|-----------|------------------------------------------|
| 01 | `01_mixed_vat_25_12.pdf` | **Two VAT rates on one invoice** (25% supplies + 12% food). | Debit 5610 + debit 7631, **one** combined 2640 input-VAT debit (297,50 + 252,00), credit 2440 total. Tests that VAT isn't assumed to be a single 25% line. |
| 02 | `02_reverse_charge_eur_hosting.pdf` | **EU reverse charge + foreign currency (EUR)**, VAT shown as 0. | Convert EUR→SEK at invoice date. Debit 6540 hosting (net). Self-assess Swedish VAT: debit 2640 *and* credit output VAT (2614 — **not in chart**). Credit 2440. Booking VAT as 0 is wrong. |
| 03 | `03_reverse_charge_usd_saas.pdf` | **USD** SaaS, reverse charge, **already paid by card**. | USD→SEK conversion. Debit 6570 software. Reverse-charge VAT pair. Credit side is **1930 bank** (paid), not 2440. |
| 04 | `04_rounding_telecom.pdf` | **Öresavrundning** line (−0,32) + two distinct telecom accounts. | Split 6211 (fast telefoni) vs 6230 (datakommunikation). Debit 2640. The −0,32 rounding has no account → plug to 3740 (missing) or 5690. Debits must still equal credits to the öre. |
| 05 | `05_inclusive_receipt.pdf` | **VAT-inclusive prices, no VAT columns**, receipt style. | Back-calculate net and VAT from the gross (624,50 incl. → 499,60 net + 124,90 VAT). Hardware/consumables → 5410/5460. Paid by card → credit 1930. |
| 06 | `06_credit_note.pdf` | **Credit note** — all amounts negative, references faktura 1047. | Every posting flips sign vs a normal purchase (credit 4010/6530 side, debit 2440). Tests that "Kreditfaktura" is detected and signs handled. |
| 07 | `07_multipage_hardware.pdf` | **Two pages, 17 line items**, freight line, asset-vs-expense judgment. | Aggregate many lines into few accounts. Laptops/chairs (>0,5 PBB? — no asset account here) vs accessories → 5410/5460, licenses → 6570, **freight has no account** → 5690. Don't drop page-2 lines. |
| 08 | `08_advertising_no_account_eur.pdf` | **No matching account** (advertising) + reverse charge + EUR. | Advertising isn't in the chart at all → 5690 with **low confidence flag**. Plus EUR conversion and reverse-charge VAT. The triple whammy. |
| 09 | `09_insurance_vat_exempt.pdf` | **Genuinely VAT-exempt** (insurance), 0% VAT but **not** reverse charge. | Debit 6310 full amount, credit 2440. **No input VAT, no self-assessment.** Contrast with 02/03/08 — the app must not treat every 0%-VAT invoice as reverse charge. |
| 10 | `10_reminder_fees.pdf` | **Payment reminder** — restates an already-booked invoice + adds VAT-free fee & interest. | Only the *new* costs are bookable: påminnelseavgift (→ 5690/6990) and dröjsmålsränta (→ interest 8xxx, **not in chart**). The 116 875 original must **not** be booked again. Both fees are VAT-free. |
| 11 | `11_reduced_6pct_and_food_change.pdf` | **6% VAT** (books) + the **2026 food-VAT change**. | Books → 6% (e.g. 6910/5610). Food/fika dated **after 2026-04-01** is temporarily 6% (was 12%) — see note below. The invoice date drives the rate. |
| 12 | `12_scanned_image_only.pdf` | **Scanned image, no text layer**, slightly skewed & grayscale. | `pdftotext` returns nothing → the app must fall back to a vision model / OCR. Same content as 01 (mixed VAT) so you can compare OCR output against the known-good answer. |

## The 2026 Swedish food-VAT change (real, and a great trap)

On 2026-02-25 the Riksdag approved a **temporary cut of VAT on foodstuffs from
12% to 6%**, effective **2026-04-01 through 2027-12-31**. So:

- Food/restaurant invoice dated **before** 2026-04-01 → **12%** (see #01, dated 2026-03-18).
- Food invoice dated **on/after** 2026-04-01 → **6%** (see #11, dated 2026-04-15).

An app that hardcodes "food = 12%" will mis-state VAT on any post-April invoice.
Standard rate stays 25%; books/transport/culture stay 6%; alcohol stays 25%.

Sources: [Skatteverket — VAT rates](https://www.skatteverket.se/servicelankar/otherlanguages/englishengelska/businessesandemployers/startingandrunningaswedishbusiness/declaringtaxesbusinesses/vat/vatratesandvatexemption.4.676f4884175c97df419255d.html),
[KPMG — temporary reduced food VAT](https://kpmg.com/us/en/taxnewsflash/news/2026/04/sweden-temporary-reduced-vat-rate-food-bottled-water.html),
[Skatteverket — omvänd betalningsskyldighet](https://www.skatteverket.se/foretag/moms/sarskildamomsregler/omvandbetalningsskyldighet.4.47eb30f51122b1aaad28000258292.html).

## Answer key — `expected.json`

[`expected.json`](./expected.json) holds the correct journal entry for every
invoice (regenerate + re-validate with `python3 expected.py` — it refuses to
write an unbalanced entry). Each record has the postings (`account`, `debit`,
`credit`), `review_flags`, any `accounts_outside_provided_chart`, and the FX
rate used. Wire it up as assertions, but treat amounts on the FX invoices
(#02/#03/#08) as rate-dependent — they were computed at the documented assumed
rates (EUR 11,30 / USD 10,50 SEK), so compare against the app's chosen rate
rather than hard-equality.

## Suggested difficulty ramp for the live interview

1. **#01** — warm-up beyond the sample: two VAT rates, clear account mapping.
2. **#04 / #05** — rounding + back-calculated VAT (numeric robustness).
3. **#02 / #03** — reverse charge + currency (the big accounting concept).
4. **#09** — the discriminator: 0% VAT that is *not* reverse charge.
5. **#07** — scale: multi-page, freight, aggregation.
6. **#12** — left-field: scanned image, no text layer.
