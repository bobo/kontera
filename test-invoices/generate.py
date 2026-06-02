#!/usr/bin/env python3
"""Generate a set of hard-edge-case Swedish invoice PDFs for testing the
invoice-to-journal-entry app.

Produces HTML files under ./build, then they are rendered to PDF with headless
Chrome (see render.sh). Each invoice deliberately exercises an accounting /
parsing edge case documented in README.md.

Pure stdlib — no third-party deps.
"""

import html
import os

BUILD = os.path.join(os.path.dirname(__file__), "build")
os.makedirs(BUILD, exist_ok=True)


def kr(x, decimals=2):
    """Swedish number formatting: space thousands separator, comma decimal."""
    neg = x < 0
    x = abs(round(x, decimals))
    whole = int(x)
    frac = round((x - whole) * (10 ** decimals))
    # rebuild to avoid float drift
    s_whole = f"{whole:,}".replace(",", " ")
    if decimals > 0:
        s = f"{s_whole},{frac:0{decimals}d}"
    else:
        s = s_whole
    return ("-" if neg else "") + s


CSS = """
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 10.5px; line-height: 1.45; }
.title { text-align: right; }
.title h1 { font-size: 30px; margin: 0; letter-spacing: 0.5px; }
.title .page { color: #444; font-size: 10px; }
.head { display: flex; justify-content: space-between; margin-top: 6px; }
.logo .main { font-size: 20px; font-weight: 700; letter-spacing: 1px; }
.logo .sub { font-size: 11px; letter-spacing: 3px; color: #333; }
.meta { width: 46%; }
.meta .row { display: flex; justify-content: space-between; }
.meta .row .k { color: #333; }
.cust { margin-top: 26px; }
.cust .name { font-weight: 700; }
.terms { display: flex; justify-content: space-between; margin-top: 26px; }
.terms .box { width: 48%; }
.terms .row { display: flex; }
.terms .row .k { width: 130px; color: #333; }
table.items { width: 100%; border-collapse: collapse; margin-top: 22px; }
table.items th { text-align: left; border-bottom: 1px solid #333; padding: 4px 6px; font-weight: 600; }
table.items td { padding: 4px 6px; vertical-align: top; }
table.items .num { text-align: right; white-space: nowrap; }
.totals { margin-top: 26px; border-top: 1px solid #333; border-bottom: 1px solid #333; padding: 8px 0; }
.totals table { width: 100%; border-collapse: collapse; }
.totals td { padding: 3px 6px; }
.totals .label { color: #333; font-size: 9.5px; }
.totals .pay { text-align: right; font-weight: 700; font-size: 14px; }
.bank { margin-top: 8px; font-size: 9.5px; color: #222; }
.note { margin-top: 14px; font-size: 9.5px; color: #111; }
.note.warn { padding: 6px 8px; border: 1px solid #999; background: #f6f6f6; }
.footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 9px; color: #333; }
.footer .col { width: 24%; }
.footer .h { color: #777; }
.pagebreak { page-break-before: always; }
.receipt { max-width: 320px; font-family: 'Courier New', monospace; font-size: 11px; }
.receipt .c { text-align: center; }
.receipt .line { border-top: 1px dashed #555; margin: 6px 0; }
.receipt .r { display: flex; justify-content: space-between; }
"""


def footer(s):
    return f"""
    <div class="footer">
      <div class="col"><div class="h">Adress</div>{s['name']}<br>{s['addr1']}<br>{s['addr2']}<br>{s.get('country','Sverige')}</div>
      <div class="col"><div class="h">Telefon</div>{s['tel']}<div class="h" style="margin-top:8px">E-post</div>{s['email']}</div>
      <div class="col"><div class="h">Bankgiro</div>{s.get('bankgiro','-')}</div>
      <div class="col"><div class="h">{s.get('orglabel','Organisationsnr')}</div>{s['orgnr']}<div class="h" style="margin-top:8px">Momsreg. nr</div>{s['vatnr']}<div style="margin-top:8px">{s.get('fskatt','Godkänd för F-skatt')}</div></div>
    </div>"""


def items_table(lines, currency, show_vat_col=False):
    head = "<tr><th>Artnr</th><th>Benämning</th><th class='num'>Antal</th><th class='num'>Á-pris</th>"
    if show_vat_col:
        head += "<th class='num'>Moms</th>"
    head += "<th class='num'>Summa</th></tr>"
    rows = ""
    for i, l in enumerate(lines, 1):
        artnr = l.get("artnr", str(i))
        antal = l.get("antal_str") or (f"{kr(l['antal'])}" if "antal" in l else "")
        apris = kr(l["apris"]) if isinstance(l.get("apris"), (int, float)) else l.get("apris", "")
        summa = kr(l["summa"])
        vatcell = f"<td class='num'>{l.get('vat_label','')}</td>" if show_vat_col else ""
        rows += (f"<tr><td>{artnr}</td><td>{html.escape(l['text'])}</td>"
                 f"<td class='num'>{antal}</td><td class='num'>{apris}</td>{vatcell}"
                 f"<td class='num'>{summa}</td></tr>")
    return f"<table class='items'><thead>{head}</thead><tbody>{rows}</tbody></table>"


def totals_block(vat_groups, currency, extra_rows=None, paid_note=None):
    """vat_groups: list of dicts {rate, net, vat}. extra_rows: list of (label, amount)."""
    net = sum(g["net"] for g in vat_groups)
    vat = sum(g["vat"] for g in vat_groups)
    extra = sum(a for _, a in (extra_rows or []))
    total = net + vat + extra
    cells = f"<td class='label'>Exkl. moms</td>"
    for g in vat_groups:
        cells += f"<td class='label'>Moms {kr(g['rate'],0) if g['rate']==int(g['rate']) else kr(g['rate'])}%</td>"
    cells += "<td class='label'>Totalt</td><td class='label' style='text-align:right'>ATT BETALA</td>"
    vals = f"<td>{kr(net)}</td>"
    for g in vat_groups:
        vals += f"<td>{kr(g['vat'])}</td>"
    vals += f"<td>{kr(total - extra)}</td><td class='pay'>{currency} {kr(total)}</td>"
    extra_html = ""
    if extra_rows:
        for label, amount in extra_rows:
            extra_html += f"<tr><td colspan='99' class='label'>{html.escape(label)}: {kr(amount)} {currency}</td></tr>"
    paid_html = f"<tr><td colspan='99' class='label'>{html.escape(paid_note)}</td></tr>" if paid_note else ""
    return (f"<div class='totals'><table><tr>{cells}</tr><tr>{vals}</tr>{extra_html}{paid_html}</table></div>")


def page(title, body):
    return (f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style>"
            f"<title>{title}</title></head><body>{body}</body></html>")


def standard_invoice(filename, seller, meta, buyer, lines, vat_groups, currency="SEK",
                     show_vat_col=False, extra_rows=None, notes=None, paid_note=None,
                     extra_pages=""):
    title_txt = meta.get("title", "Faktura")
    head = f"""
    <div class='title'><h1>{title_txt}</h1><span class='page'>{meta.get('page','Sida 1(1)')}</span></div>
    <div class='head'>
      <div class='logo'><div class='main'>{seller['logo_main']}</div><div class='sub'>{seller.get('logo_sub','')}</div></div>
      <div class='meta'>
        <div class='row'><span class='k'>Fakturadatum</span><span>{meta['datum']}</span></div>
        <div class='row'><span class='k'>{meta.get('nrlabel','Fakturanr')}</span><span>{meta['nr']}</span></div>
        {('<div class="row"><span class="k">OCR</span><span>'+meta['ocr']+'</span></div>') if meta.get('ocr') else ''}
        {('<div class="row"><span class="k">Valuta</span><span>'+currency+'</span></div>') if currency!='SEK' else ''}
      </div>
    </div>
    <div class='cust'><div class='name'>{buyer['name']}</div>{buyer['lines']}</div>
    <div class='terms'>
      <div class='box'><div class='row'><span class='k'>Kundnr</span><span>{buyer.get('kundnr','')}</span></div></div>
      <div class='box'>
        <div class='row'><span class='k'>Betalningsvillkor</span><span>{meta.get('villkor','30 dagar')}</span></div>
        <div class='row'><span class='k'>Förfallodatum</span><span>{meta.get('forfallo','')}</span></div>
        <div class='row'><span class='k'>Dröjsmålsränta</span><span>{meta.get('ranta','8%')}</span></div>
      </div>
    </div>
    """
    body = head + items_table(lines, currency, show_vat_col)
    body += totals_block(vat_groups, currency, extra_rows, paid_note)
    iban = seller.get("iban")
    if iban:
        body += f"<div class='bank'>IBAN {iban}&nbsp;&nbsp;BIC {seller.get('bic','')}</div>"
    for n in (notes or []):
        cls = "note warn" if n.get("warn") else "note"
        body += f"<div class='{cls}'>{n['text']}</div>"
    body += footer(seller)
    body += extra_pages
    with open(os.path.join(BUILD, filename + ".html"), "w") as f:
        f.write(page(filename, body))
    print("wrote", filename + ".html")


# ---------------------------------------------------------------------------
# Sellers
# ---------------------------------------------------------------------------

kontorsboden = dict(
    logo_main="KONTORSBODEN", logo_sub="AB",
    name="Kontorsboden i Sverige AB", addr1="Lagervägen 22", addr2="120 30 Stockholm",
    tel="08-556 200 10", email="faktura@kontorsboden.se", bankgiro="5810-1122",
    orgnr="556712-9087", vatnr="SE556712908701",
)

telia = dict(
    logo_main="TELIA", logo_sub="FÖRETAG",
    name="Telia Sverige AB", addr1="Stjärntorget 1", addr2="169 79 Solna",
    tel="90 200", email="foretag@telia.se", bankgiro="901-1199",
    orgnr="556430-0142", vatnr="SE556430014201",
)

hetzner = dict(
    logo_main="HETZNER", logo_sub="ONLINE",
    name="Hetzner Online GmbH", addr1="Industriestr. 25", addr2="91710 Gunzenhausen",
    country="Tyskland / Germany", tel="+49 9831 5050", email="invoice@hetzner.com",
    bankgiro="-", orgnr="HRB 6089 Ansbach", orglabel="Registernr",
    vatnr="DE812871812", fskatt="",
)

dustin = dict(
    logo_main="DUSTIN", logo_sub="",
    name="Dustin Sverige AB", addr1="Augustendalsvägen 7", addr2="131 52 Nacka Strand",
    tel="08-553 444 00", email="faktura@dustin.se", bankgiro="5096-3322",
    orgnr="556237-8785", vatnr="SE556237878501",
)

google = dict(
    logo_main="Google", logo_sub="",
    name="Google Ireland Limited", addr1="Gordon House, Barrow Street", addr2="Dublin 4",
    country="Irland / Ireland", tel="-", email="collections@google.com",
    bankgiro="-", orgnr="IE368047", orglabel="Company no.",
    vatnr="IE6388047V", fskatt="",
)

trygghansa = dict(
    logo_main="TRYGG-HANSA", logo_sub="FÖRSÄKRING",
    name="Trygg-Hansa Försäkring AB", addr1="Fleminggatan 18", addr2="106 26 Stockholm",
    tel="0771-111 110", email="foretag@trygghansa.se", bankgiro="220-4455",
    orgnr="516401-7799", vatnr="SE516401779901",
)

brightit = dict(
    logo_main="BRIGHT IT", logo_sub="SOLUTIONS",
    name="Bright IT Solutions AB", addr1="Teknikgatan 14", addr2="115 34 Stockholm",
    tel="08-331 045 00", email="faktura@brightit.se", bankgiro="731-2045",
    orgnr="559201-4873", vatnr="SE559201487301",
    iban="SE91 8000 0890 1145 6732 0019", bic="SWEDSESS",
)

notion = dict(
    logo_main="Notion", logo_sub="LABS",
    name="Notion Labs, Inc.", addr1="2300 Harrison St", addr2="San Francisco, CA 94110",
    country="USA", tel="-", email="team@notion.so", bankgiro="-",
    orgnr="—", orglabel="Reg.", vatnr="EU372008451", fskatt="",
)

elgrossisten = dict(
    logo_main="BYGG & JÄRN", logo_sub="DEPÅN",
    name="Bygg & Järndepån AB", addr1="Verkstadsgatan 4", addr2="212 14 Malmö",
    tel="040-611 22 00", email="info@byggjarn.se", bankgiro="345-8800",
    orgnr="556901-2233", vatnr="SE556901223301",
)

bokforlag = dict(
    logo_main="LIBER", logo_sub="UTBILDNING",
    name="Liber Utbildning AB", addr1="Normalmstorg 1", addr2="111 46 Stockholm",
    tel="08-690 90 00", email="order@liber.se", bankgiro="410-2299",
    orgnr="556067-1118", vatnr="SE556067111801",
)


def buyer_block():
    return dict(name="Bright IT Solutions AB",
                lines="Att: Ekonomiavdelningen, Teknikgatan 14<br>115 34 STOCKHOLM<br>Sverige",
                kundnr="—", vatnr="SE559201487301")


# ===========================================================================
# 01 — Mixed VAT rates (25% office supplies + 12% food, pre-April-2026)
# ===========================================================================
b = buyer_block()
lines = [
    dict(text="Kopieringspapper A4 80g (fp om 500)", antal=10, apris=89.00, summa=890.00),
    dict(text="Whiteboardpennor sortiment", antal=20, apris=15.00, summa=300.00),
    dict(text="Smörgåstårta personalmöte 20 pers", antal=1, apris=1200.00, summa=1200.00),
    dict(text="Kaffebönor Mellanrost 1 kg", antal=6, apris=150.00, summa=900.00),
]
standard_invoice(
    "01_mixed_vat_25_12", kontorsboden,
    dict(datum="2026-03-18", nr="240331", forfallo="2026-04-17", villkor="30 dagar"),
    b, lines,
    [dict(rate=25, net=1190.00, vat=297.50), dict(rate=12, net=2100.00, vat=252.00)],
    notes=[{"text": "Moms specificeras per momssats. Livsmedel debiteras 12% (faktura före 2026-04-01)."}],
)

# ===========================================================================
# 02 — Reverse charge, EU services, EUR (hosting)
# ===========================================================================
b = buyer_block()
lines = [
    dict(text="Dedicated Server EX44 (monthly)", antal=1, apris=49.00, summa=49.00),
    dict(text="Additional IPv4 address", antal=1, apris=1.70, summa=1.70),
    dict(text="Traffic overage 2 TB", antal=1, apris=2.00, summa=2.00),
    dict(text="One-time setup fee", antal=1, apris=39.00, summa=39.00),
]
standard_invoice(
    "02_reverse_charge_eur_hosting", hetzner,
    dict(datum="2026-04-30", nr="R0049928171", forfallo="2026-05-15", villkor="14 dagar", ranta="—"),
    b, lines,
    [dict(rate=0, net=91.70, vat=0.00)],
    currency="EUR",
    notes=[{"warn": True, "text": "<b>Reverse charge</b> — VAT to be accounted for by the recipient. "
            "Steuerschuldnerschaft des Leistungsempfängers. Customer VAT ID: SE559201487301. "
            "Net amount EUR — no German VAT charged."}],
)

# ===========================================================================
# 03 — Foreign currency USD SaaS, reverse charge, annual
# ===========================================================================
b = buyer_block()
lines = [
    dict(text="Notion Plus plan — annual (5 members)", antal=5, apris=96.00, summa=480.00),
]
standard_invoice(
    "03_reverse_charge_usd_saas", notion,
    dict(datum="2026-05-02", nr="INV-2026-88213", forfallo="2026-05-02", villkor="Betald / Due on receipt", ranta="—"),
    b, lines,
    [dict(rate=0, net=480.00, vat=0.00)],
    currency="USD",
    notes=[{"warn": True, "text": "Reverse charge applies. VAT to be self-assessed by the customer "
            "(customer VAT ID SE559201487301). No US sales tax. Amounts in USD."},
           {"text": "Payment method: Visa ****4417. This is a receipt for your records."}],
    paid_note="Betalt med kort — Visa ****4417",
)

# ===========================================================================
# 04 — Öresavrundning + two telecom accounts
# ===========================================================================
b = buyer_block()
lines = [
    dict(text="Företagsabonnemang fast telefoni (mars)", antal=1, apris=249.00, summa=249.00),
    dict(text="Bredband Fiber 1000/1000 (mars)", antal=1, apris=595.00, summa=595.00),
    dict(text="Mobilt bredband 4G backup (mars)", antal=1, apris=129.00, summa=129.00),
    dict(text="Öresavrundning", antal_str="", summa=-0.32, artnr=""),
]
# net 973.00, vat 25% = 243.25, +rounding -0.32 => total 1215.93
standard_invoice(
    "04_rounding_telecom", telia,
    dict(datum="2026-03-31", nr="100447712", forfallo="2026-04-30", villkor="30 dagar", ocr="100447712"),
    b, lines,
    [dict(rate=25, net=973.00, vat=243.25)],
    extra_rows=[("Öresavrundning", -0.32)],
    notes=[{"text": "Fast telefoni och datakommunikation specificeras separat. Öresavrundning tillämpad på totalbeloppet."}],
)

# ===========================================================================
# 05 — VAT-inclusive receipt (no VAT breakdown columns), hardware store
# ===========================================================================
b = buyer_block()
# Prices shown incl. VAT 25%. Gross 624.50 -> net 499.60, vat 124.90
receipt_body = f"""
<div class='receipt'>
  <div class='c'><b>BYGG &amp; JÄRNDEPÅN AB</b><br>Verkstadsgatan 4, 212 14 Malmö<br>Org.nr 556901-2233 &nbsp; Moms SE556901223301</div>
  <div class='line'></div>
  <div class='c'>KVITTO / FÖRENKLAD FAKTURA</div>
  <div>Datum: 2026-05-12 14:08 &nbsp; Kvittonr: 55-209813</div>
  <div class='line'></div>
  <div class='r'><span>Spånskruv 4x40 (ask 200)</span><span>89,00</span></div>
  <div class='r'><span>Batteri borrmaskin 18V</span><span>449,00</span></div>
  <div class='r'><span>Arbetshandskar (3-pack)</span><span>86,50</span></div>
  <div class='line'></div>
  <div class='r'><b>TOTALT (inkl. moms)</b><b>624,50 kr</b></div>
  <div class='r'><span>Varav moms 25%</span><span>124,90</span></div>
  <div class='line'></div>
  <div>Betalt: Kort Mastercard ****3391</div>
  <div class='c' style='margin-top:10px'>Tack för ditt köp!</div>
</div>
"""
with open(os.path.join(BUILD, "05_inclusive_receipt.html"), "w") as f:
    f.write(page("05_inclusive_receipt", receipt_body))
print("wrote 05_inclusive_receipt.html")

# ===========================================================================
# 06 — Credit note (kreditfaktura), negative amounts, references original
# ===========================================================================
b = buyer_block()
b["name"] = "Kallberg & Partners AB"
b["lines"] = "Erik Kallberg, Storgatan 8<br>413 01 GÖTEBORG<br>Sverige"
b["kundnr"] = "1192"
lines = [
    dict(text="Kreditering API-integration (faktura 1047)", antal=-8.00, apris=1250.00, summa=-10000.00),
]
standard_invoice(
    "06_credit_note", brightit,
    dict(title="Kreditfaktura", datum="2026-04-02", nr="1051", nrlabel="Kreditfakturanr",
         forfallo="—", villkor="—", ranta="—"),
    b, lines,
    [dict(rate=25, net=-10000.00, vat=-2500.00)],
    notes=[{"text": "Kreditfaktura avseende del av faktura 1047 (8 timmar á 1 250,00 krediteras pga felaktig debitering). "
            "Beloppen är negativa."}],
)

# ===========================================================================
# 07 — Multi-page, many line items, freight (no matching account), mixed asset/expense
# ===========================================================================
b = buyer_block()
many = [
    ("Lenovo ThinkPad T14 Gen5 (i7/32GB)", 2, 14900.00),
    ("Dockningsstation USB-C Gen2", 2, 1790.00),
    ("Bildskärm Dell 27\" QHD", 3, 2490.00),
    ("Tangentbord Logitech MX Keys", 4, 990.00),
    ("Mus Logitech MX Master 3S", 4, 790.00),
    ("USB-C kabel 2m (5-pack)", 2, 245.00),
    ("HDMI-adapter USB-C", 6, 159.00),
    ("Headset Jabra Evolve2 65", 3, 1690.00),
    ("Webbkamera Logitech Brio", 2, 1490.00),
    ("Microsoft 365 Business Premium (årslic.)", 5, 2640.00),
    ("Adobe Acrobat Pro (årslic.)", 2, 2200.00),
    ("Externt SSD 2TB Samsung T7", 3, 1790.00),
    ("Laptopväska 14\"", 2, 449.00),
    ("Skärmrengöring & mikrofiber kit", 5, 89.00),
    ("Kontorsstol ErgoFlex (justerbar)", 2, 2990.00),
    ("Skrivbordslampa LED", 4, 399.00),
    ("Frakt & emballage", 1, 395.00),
]
lines = [dict(text=t, antal=q, apris=p, summa=q * p) for t, q, p in many]
net07 = sum(l["summa"] for l in lines)
vat07 = round(net07 * 0.25, 2)
# split across 2 pages visually: put first 11 on page 1, rest on page 2 with continued header
first = lines[:11]
rest = lines[11:]
# We'll render page 1 items, then a manual second page with remaining items + totals.
# Simpler: render all in one table but force a page break midway is hard; instead build custom.
p1_head = f"""
<div class='title'><h1>Faktura</h1><span class='page'>Sida 1(2)</span></div>
<div class='head'>
  <div class='logo'><div class='main'>{dustin['logo_main']}</div><div class='sub'></div></div>
  <div class='meta'>
    <div class='row'><span class='k'>Fakturadatum</span><span>2026-05-20</span></div>
    <div class='row'><span class='k'>Fakturanr</span><span>90388214</span></div>
    <div class='row'><span class='k'>OCR</span><span>90388214</span></div>
  </div>
</div>
<div class='cust'><div class='name'>{b['name']}</div>{b['lines']}</div>
<div class='terms'><div class='box'><div class='row'><span class='k'>Kundnr</span><span>44192</span></div></div>
<div class='box'><div class='row'><span class='k'>Betalningsvillkor</span><span>20 dagar</span></div>
<div class='row'><span class='k'>Förfallodatum</span><span>2026-06-09</span></div></div></div>
"""
p1 = p1_head + items_table(first, "SEK")
p2_head = "<div class='pagebreak'></div><div class='title'><h1>Faktura</h1><span class='page'>Sida 2(2)</span></div><div style='margin-top:10px'>Fakturanr 90388214 (forts.)</div>"
p2 = p2_head + items_table(rest, "SEK")
p2 += totals_block([dict(rate=25, net=net07, vat=vat07)], "SEK")
p2 += "<div class='note'>Anläggningstillgångar och förbrukningsinventarier på samma faktura. Frakt debiteras 25% moms.</div>"
p2 += footer(dustin)
with open(os.path.join(BUILD, "07_multipage_hardware.html"), "w") as f:
    f.write(page("07_multipage_hardware", p1 + p2))
print(f"wrote 07_multipage_hardware.html (net={kr(net07)} vat={kr(vat07)})")

# ===========================================================================
# 08 — No clean account match (advertising) + reverse charge + EUR
# ===========================================================================
b = buyer_block()
lines = [
    dict(text="Google Ads — kampanj april 2026", antal=1, apris=842.55, summa=842.55),
]
standard_invoice(
    "08_advertising_no_account_eur", google,
    dict(datum="2026-04-30", nr="5298837461", forfallo="2026-04-30", villkor="Autodebitering", ranta="—"),
    b, lines,
    [dict(rate=0, net=842.55, vat=0.00)],
    currency="EUR",
    notes=[{"warn": True, "text": "Reverse charge — VAT to be accounted for by the customer (SE559201487301). "
            "Services supplied under EU main rule, art. 196 VAT Directive."},
           {"text": "Det finns inget självklart konto för annonsering/marknadsföring i kontoplanen."}],
)

# ===========================================================================
# 09 — VAT-exempt insurance (NOT reverse charge — must not invent input VAT)
# ===========================================================================
b = buyer_block()
lines = [
    dict(text="Företagsförsäkring Kombinerad — premie helår 2026", antal=1, apris=8640.00, summa=8640.00),
    dict(text="Tilläggsförsäkring Cyber & dataintrång", antal=1, apris=2160.00, summa=2160.00),
]
standard_invoice(
    "09_insurance_vat_exempt", trygghansa,
    dict(datum="2026-01-15", nr="FÖ-2026-44821", forfallo="2026-02-14", villkor="30 dagar"),
    b, lines,
    [dict(rate=0, net=10800.00, vat=0.00)],
    notes=[{"text": "Försäkringspremier är undantagna från moms enligt 3 kap. 10 § ML. Ingen moms debiteras "
            "(detta är INTE omvänd skattskyldighet)."}],
)

# ===========================================================================
# 10 — Reminder invoice: fee + penalty interest, both VAT-free, no account
# ===========================================================================
b = buyer_block()
b["name"] = "Kallberg & Partners AB"
b["lines"] = "Erik Kallberg, Storgatan 8<br>413 01 GÖTEBORG<br>Sverige"
b["kundnr"] = "1192"
lines = [
    dict(text="Ursprunglig faktura 1047 (förfallen)", antal_str="", apris="", summa=116875.00, artnr=""),
    dict(text="Påminnelseavgift", antal_str="", apris="", summa=60.00, artnr=""),
    dict(text="Dröjsmålsränta 8% (32 dagar)", antal_str="", apris="", summa=819.45, artnr=""),
]
# This is a payment reminder, not a fresh cost — fee+interest are the only NEW bookable items.
with open(os.path.join(BUILD, "10_reminder_fees.html"), "w") as f:
    body = f"""
    <div class='title'><h1>Betalningspåminnelse</h1><span class='page'>Sida 1(1)</span></div>
    <div class='head'><div class='logo'><div class='main'>{brightit['logo_main']}</div><div class='sub'>{brightit['logo_sub']}</div></div>
    <div class='meta'>
      <div class='row'><span class='k'>Datum</span><span>2026-05-11</span></div>
      <div class='row'><span class='k'>Påminnelsenr</span><span>P-1047</span></div>
      <div class='row'><span class='k'>Avser faktura</span><span>1047</span></div>
    </div></div>
    <div class='cust'><div class='name'>{b['name']}</div>{b['lines']}</div>
    {items_table(lines, 'SEK')}
    <div class='totals'><table>
      <tr><td class='label'>Förfallet fakturabelopp</td><td class='label'>Påminnelseavgift</td><td class='label'>Dröjsmålsränta</td><td class='label' style='text-align:right'>ATT BETALA</td></tr>
      <tr><td>{kr(116875.00)}</td><td>{kr(60.00)}</td><td>{kr(819.45)}</td><td class='pay'>SEK {kr(117754.45)}</td></tr>
    </table></div>
    <div class='note'>Påminnelseavgift och dröjsmålsränta är ej momspliktiga. Endast avgiften och räntan är nya kostnader — "
    "ursprungsfakturan ska inte bokföras två gånger.</div>
    {footer(brightit)}
    """
    f.write(page("10_reminder_fees", body))
print("wrote 10_reminder_fees.html")

# ===========================================================================
# 11 — Reduced 6% VAT (books/course material) + the April-2026 food VAT change
# ===========================================================================
b = buyer_block()
lines = [
    dict(text="Kursbok 'Bokföring i praktiken' (tryckt)", antal=10, apris=349.00, summa=3490.00),
    dict(text="Fika till internutbildning (faktura efter 2026-04-01)", antal=1, apris=900.00, summa=900.00),
]
# Books 6%, food now ALSO 6% after April 1 2026 (temporary). net book 3490 vat 209.40; food 900 vat 54.00
standard_invoice(
    "11_reduced_6pct_and_food_change", bokforlag,
    dict(datum="2026-04-15", nr="LB-2026-7782", forfallo="2026-05-15", villkor="30 dagar"),
    b, lines,
    [dict(rate=6, net=4390.00, vat=263.40)],
    notes=[{"text": "Böcker har 6% moms. OBS: livsmedel/fika har tillfälligt 6% moms fr.o.m. 2026-04-01 "
            "(tidigare 12%) — datumet på fakturan avgör momssatsen."}],
)

# ===========================================================================
# 13 — Öresavrundning (demo for automatic sub-krona rounding)
# ===========================================================================
# Unlike #04, the rounding is applied ONLY to the payable total — there is no
# rounding line item to absorb it. So line items sum exactly to net, the
# extraction self-check passes (diff < 50 öre → no LLM fallback), but
# net + VAT (1 543,25) ≠ ATT BETALA (1 543,00). The assembler closes the 25-öre
# gap automatically (a 5690 "Öresavrundning" posting) and the invoice arrives
# `proposed` with an advisory flag — no human step needed for genuine rounding.
b = buyer_block()
lines = [
    dict(text="Molnlagring Business 1TB (mars)", antal=1, apris=899.00, summa=899.00),
    dict(text="Domänregistrering exempel.se (12 mån)", antal=1, apris=95.60, summa=95.60),
    dict(text="SSL-certifikat Wildcard", antal=1, apris=240.00, summa=240.00),
]
# net 1 234,60, vat 25% = 308,65, total 1 543,25 → öresavrundning -0,25 → att betala 1 543,00
standard_invoice(
    "13_unbalanced_rounding", dustin,
    dict(datum="2026-03-31", nr="90412255", forfallo="2026-04-30", villkor="30 dagar", ocr="90412255"),
    b, lines,
    [dict(rate=25, net=1234.60, vat=308.65)],
    extra_rows=[("Öresavrundning", -0.25)],
    notes=[{"text": "Öresavrundning tillämpad på att betala-beloppet (ingen separat rad)."}],
)

print("\nAll HTML generated in", BUILD)
