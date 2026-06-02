#!/usr/bin/env python3
"""Build expected.json — the answer-key journal entry for each test invoice.

Each entry is validated to balance (sum debit == sum credit) before writing,
so the fixture can't silently drift. Run: python3 expected.py
"""
import json, os

# Assumed FX rates (SEK per unit) for the foreign-currency invoices.
# A real app should use the Riksbank rate at the invoice date; these are the
# rates the expected entries below were computed with.
FX = {"EUR": 11.30, "USD": 10.50}

ACCOUNT_NAMES = {
    "1930": "Företagskonto", "2440": "Leverantörsskulder", "2614": "Utgående moms omvänd skattskyldighet",
    "2640": "Ingående moms", "4010": "Inköp material & varor", "5010": "Lokalhyra",
    "5410": "Förbrukningsinventarier", "5460": "Förbrukningsmaterial", "5610": "Kontorsmaterial",
    "5690": "Övriga kontorskostnader", "6110": "Kontorsförnödenheter", "6211": "Fast telefoni",
    "6230": "Datakommunikation", "6310": "Företagsförsäkringar", "6530": "IT-tjänster",
    "6540": "IT-drift & hosting", "6570": "Programvara, licenser", "6910": "Licensavgifter & medlemskap",
    "7631": "Personalmat & fika", "8420": "Räntekostnader (EJ i tillhandahållen kontoplan)",
}
# Accounts a correct entry needs but that are NOT in the provided 20-account chart.
NOT_IN_CHART = {"2614", "8420"}


def D(acc, amt):  # debit
    return {"account": acc, "name": ACCOUNT_NAMES[acc], "debit": round(amt, 2), "credit": 0.0}

def C(acc, amt):  # credit
    return {"account": acc, "name": ACCOUNT_NAMES[acc], "debit": 0.0, "credit": round(amt, 2)}


invoices = []

def add(id, file, currency, total_invoice, postings, fx=None, flags=None, notes=""):
    invoices.append(dict(
        id=id, file=file, currency=currency,
        fx_rate_to_sek=fx, invoice_total=round(total_invoice, 2),
        accounts_outside_provided_chart=sorted({p["account"] for p in postings} & NOT_IN_CHART) or None,
        review_flags=flags or [], notes=notes,
        journal_entry=postings,
    ))

# 01 — mixed VAT 25% + 12%
add("01", "01_mixed_vat_25_12.pdf", "SEK", 3839.50, [
    D("5610", 1190.00),   # papper + pennor (25%)
    D("7631", 2100.00),   # fika + kaffe (12%)
    D("2640", 549.50),    # 297,50 (25%) + 252,00 (12%)
    C("2440", 3839.50),
], notes="Two VAT rates collapse into one 2640 posting.")

# 02 — EU reverse charge, EUR
eur = FX["EUR"]
net02 = round(91.70 * eur, 2)            # 1036.21
vat02 = round(net02 * 0.25, 2)           # 259.05
add("02", "02_reverse_charge_eur_hosting.pdf", "EUR", 91.70, [
    D("6540", net02),
    D("2640", vat02),     # self-assessed input VAT
    C("2614", vat02),     # self-assessed output VAT (reverse charge)
    C("2440", net02),
], fx=eur, flags=["reverse_charge", "fx_conversion"],
   notes="0% VAT on the invoice; buyer self-assesses 25% Swedish VAT both ways. 2614 not in provided chart.")

# 03 — USD reverse charge, paid by card
usd = FX["USD"]
net03 = round(480.00 * usd, 2)           # 5040.00
vat03 = round(net03 * 0.25, 2)           # 1260.00
add("03", "03_reverse_charge_usd_saas.pdf", "USD", 480.00, [
    D("6570", net03),
    D("2640", vat03),
    C("2614", vat03),
    C("1930", net03),     # paid by card -> bank, not 2440
], fx=usd, flags=["reverse_charge", "fx_conversion", "already_paid"],
   notes="Paid by card so credit side is 1930, not 2440. Reverse charge VAT pair.")

# 04 — rounding + telecom split
add("04", "04_rounding_telecom.pdf", "SEK", 1215.93, [
    D("6211", 249.00),    # fast telefoni
    D("6230", 724.00),    # fiber 595 + mobilt bredband 129
    D("2640", 243.25),
    D("5690", -0.32),     # öresavrundning, no rounding account in chart (ideally 3740)
    C("2440", 1215.93),
], flags=["rounding_line"],
   notes="Öresavrundning -0,32 plugged to 5690 (3740 would be ideal but is not in chart).")

# 05 — VAT-inclusive receipt, paid by card
add("05", "05_inclusive_receipt.pdf", "SEK", 624.50, [
    D("5410", 359.20),    # batteri borrmaskin (net of incl. 449)
    D("5460", 140.40),    # skruv 71,20 + handskar 69,20
    D("2640", 124.90),    # back-calculated VAT
    C("1930", 624.50),    # paid by card
], flags=["vat_inclusive_pricing", "already_paid"],
   notes="Prices include 25% VAT; net and VAT back-calculated from the gross 624,50.")

# 06 — credit note (signs flip)
add("06", "06_credit_note.pdf", "SEK", -12500.00, [
    D("6530", -10000.00), # IT-tjänster reversed
    D("2640", -2500.00),
    C("2440", -12500.00),
], flags=["credit_note"],
   notes="All amounts negative; effectively credit 6530/2640 and debit 2440.")

# 07 — multipage hardware
add("07", "07_multipage_hardware.pdf", "SEK", 112185.00, [
    D("5410", 68966.00),  # laptops, monitors, peripherals, chairs, lamps
    D("5460", 2787.00),   # cables, adapters, cases, cleaning
    D("6570", 17600.00),  # MS365 + Adobe licenses
    D("5690", 395.00),    # freight (no freight account in chart)
    D("2640", 22437.00),
    C("2440", 112185.00),
], flags=["multi_page", "no_freight_account"],
   notes="17 lines across 2 pages aggregated into few accounts; freight -> 5690.")

# 08 — advertising, no account, EUR, reverse charge
net08 = round(842.55 * eur, 2)           # 9520.82
vat08 = round(net08 * 0.25, 2)           # 2380.21
add("08", "08_advertising_no_account_eur.pdf", "EUR", 842.55, [
    D("5690", net08),     # advertising has NO account in chart
    D("2640", vat08),
    C("2614", vat08),
    C("2440", net08),
], fx=eur, flags=["reverse_charge", "fx_conversion", "no_matching_account", "low_confidence"],
   notes="Advertising/marketing absent from chart -> 5690 with low confidence. Plus EUR + reverse charge.")

# 09 — VAT-exempt insurance (NOT reverse charge)
add("09", "09_insurance_vat_exempt.pdf", "SEK", 10800.00, [
    D("6310", 10800.00),
    C("2440", 10800.00),
], flags=["vat_exempt"],
   notes="Insurance is VAT-exempt (3 kap. 10 § ML). NO input VAT, NOT reverse charge. The discriminator vs 02/03/08.")

# 10 — reminder: only the new fees are bookable
add("10", "10_reminder_fees.pdf", "SEK", 879.45, [
    D("5690", 60.00),     # påminnelseavgift (VAT-free)
    D("8420", 819.45),    # dröjsmålsränta -> interest, not in chart
    C("2440", 879.45),
], flags=["do_not_rebook_original", "vat_free_fees"],
   notes="The 116 875 original invoice must NOT be booked again. Only fee + interest are new costs, both VAT-free.")

# 11 — 6% VAT books + post-April food at 6%
add("11", "11_reduced_6pct_and_food_change.pdf", "SEK", 4653.40, [
    D("5610", 3490.00),   # course books (no dedicated book/training account in chart)
    D("7631", 900.00),    # fika
    D("2640", 263.40),    # 6% on both (food temporarily 6% after 2026-04-01)
    C("2440", 4653.40),
], flags=["reduced_vat_6pct", "food_vat_change_2026"],
   notes="Books 6%; food dated 2026-04-15 is 6% under the temporary 2026 cut (was 12%).")

# 12 — scanned, same content as 01
add("12", "12_scanned_image_only.pdf", "SEK", 3839.50, [
    D("5610", 1190.00),
    D("7631", 2100.00),
    D("2640", 549.50),
    C("2440", 3839.50),
], flags=["no_text_layer", "requires_ocr_or_vision"],
   notes="Image-only scan of invoice 01; expected entry is identical once OCR/vision recovers the content.")


# ---- validate balance ----
errors = []
for inv in invoices:
    deb = round(sum(p["debit"] for p in inv["journal_entry"]), 2)
    cred = round(sum(p["credit"] for p in inv["journal_entry"]), 2)
    if deb != cred:
        errors.append(f"{inv['id']}: debit {deb} != credit {cred}")
if errors:
    raise SystemExit("UNBALANCED ENTRIES:\n" + "\n".join(errors))

out = dict(
    description="Answer-key journal entries for the hard test invoices. Synthetic data.",
    assumptions=dict(
        fx_rates_sek_per_unit=FX,
        fx_note="Foreign-currency invoices were computed with these rates; a real app should use the Riksbank rate at the invoice date.",
        vat_note="Standard 25%, reduced 12%/6%. Food temporarily 6% from 2026-04-01 (was 12%).",
        accounts_outside_chart="2614 (output VAT reverse charge) and 8420 (interest) are required by correct accounting but are NOT in the provided 20-account chart.",
    ),
    invoices=invoices,
)
path = os.path.join(os.path.dirname(__file__), "expected.json")
with open(path, "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print(f"wrote {path} — {len(invoices)} entries, all balanced.")
