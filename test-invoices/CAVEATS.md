# Caveats — read before wiring `expected.json` as assertions

Two things make a naive hard-equality check against the answer key misleading:

## 1. FX invoices are rate-dependent (#02, #03, #08)

`02_reverse_charge_eur_hosting`, `03_reverse_charge_usd_saas` and
`08_advertising_no_account_eur` are in foreign currency. The expected SEK
amounts were computed at **assumed** rates:

- EUR → 11,30 SEK
- USD → 10,50 SEK

A real app should use the Riksbank rate at the invoice date, so its amounts
will differ. **Assert on structure, not exact öre:** which accounts are hit and
that the reverse-charge VAT pair (input 2640 + output 2614) is present and
equal. Only compare amounts against the rate the app actually chose.

## 2. Some "correct" accounts aren't in the provided chart

The 20-account chart can't express every correct posting. These cases require
accounts that don't exist in it:

- **#08 advertising** — no advertising/marketing account → falls back to `5690`
- **#10 interest** — dröjsmålsränta belongs in `8420`, absent from the chart
- **#02 / #03 / #08 reverse charge** — need output-VAT account `2614`, absent

For these, the test is as much *how the app handles a missing mapping*
(least-wrong account + a low-confidence / review flag) as the mapping itself.
`expected.json` lists these under `accounts_outside_provided_chart` and
`review_flags` so you can assert on the flag rather than demanding an account
the chart doesn't contain.
