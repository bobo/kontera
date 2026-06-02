"use client";

import { formatOre } from "@/lib/money";
import { formatDate, type Locale, type Strings } from "@/lib/i18n";
import type { InvoiceView, LineItemView } from "@/lib/api-contract";

export function BillDocument({
  invoice,
  lineItems,
  t,
  locale,
}: {
  invoice: InvoiceView;
  lineItems: LineItemView[];
  t: Strings;
  locale: Locale;
}) {
  const cur = invoice.currency;
  return (
    <div className="paper">
      <div className="paper-sheet">
        <div className="bill-head">
          <div>
            <div className="bill-supplier">{invoice.supplierName ?? "—"}</div>
            {invoice.supplierOrgNr && (
              <div className="bill-supplier-meta">Org.nr {invoice.supplierOrgNr}</div>
            )}
          </div>
          <div className="bill-title-block">
            <span className="bill-mark" aria-hidden="true" />
            <span className="bill-title">FAKTURA</span>
          </div>
        </div>

        <div className="bill-meta">
          <div>
            <div className="bill-meta-label">{t.invoice_no}</div>
            <div className="bill-meta-strong mono">{invoice.invoiceNumber ?? "—"}</div>
          </div>
          <div className="bill-meta-right">
            <div className="bill-meta-row">
              <span>{t.rev_invoice_date}</span>
              <b>{formatDate(invoice.invoiceDate, locale)}</b>
            </div>
            <div className="bill-meta-row">
              <span>{t.due}</span>
              <b>{formatDate(invoice.dueDate, locale)}</b>
            </div>
          </div>
        </div>

        <table className="bill-table">
          <thead>
            <tr>
              <th className="ta-l">{t.col_desc}</th>
              <th className="ta-r">{t.qty}</th>
              <th className="ta-r">{t.unit_price}</th>
              <th className="ta-r">{t.line_amount}</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="ta-r mono">{l.quantity ?? "—"}</td>
                <td className="ta-r mono">{l.unitPriceOre != null ? formatOre(l.unitPriceOre) : "—"}</td>
                <td className="ta-r mono">{formatOre(l.amountOre)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="bill-totals">
          <div className="bill-total-row">
            <span>{t.net}</span>
            <span className="mono">{formatOre(invoice.netOre)}</span>
          </div>
          <div className="bill-total-row">
            <span>
              {t.vat}
              {invoice.vatRate != null ? ` ${invoice.vatRate}%` : ""}
            </span>
            <span className="mono">{formatOre(invoice.vatOre)}</span>
          </div>
          <div className="bill-total-row bill-total-grand">
            <span>{t.to_pay}</span>
            <span className="mono">
              {cur} {formatOre(invoice.grossOre)}
            </span>
          </div>
        </div>

        {invoice.fxRate !== 1 && (
          <div className="bill-footer">
            <span>
              FX {invoice.currency}→SEK <b>{invoice.fxRate}</b> · amounts shown in SEK
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
