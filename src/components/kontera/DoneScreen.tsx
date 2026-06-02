"use client";

import { formatSek } from "@/lib/money";
import { formatDate, type Locale, type Strings } from "@/lib/i18n";
import type { InvoiceView } from "@/lib/api-contract";

export function DoneScreen({
  t,
  locale,
  approved,
  invoice,
  onAgain,
}: {
  t: Strings;
  locale: Locale;
  approved: boolean;
  invoice: InvoiceView;
  onAgain: () => void;
}) {
  return (
    <div className="screen-center">
      <div className={"done-mark " + (approved ? "ok" : "no")} aria-hidden="true">
        {approved ? "✓" : "↺"}
      </div>
      <h1 className="upload-title">{approved ? t.approved_title : t.declined_title}</h1>
      <p className="upload-sub">{approved ? t.approved_sub : t.declined_sub}</p>
      {approved && (
        <div className="done-card">
          <div className="done-row">
            <span>{t.vernr}</span>
            <b className="mono">V-{invoice.id.slice(0, 8).toUpperCase()}</b>
          </div>
          <div className="done-row">
            <span>{t.posted_on}</span>
            <b>{formatDate(invoice.invoiceDate, locale)}</b>
          </div>
          <div className="done-row">
            <span>{t.rev_total}</span>
            <b className="mono">{formatSek(invoice.grossOre)}</b>
          </div>
          <div className="done-row done-bal">
            <span>{t.totals}</span>
            <span className="balance ok">
              <span className="bal-check">✓</span>
              {t.balanced}
            </span>
          </div>
        </div>
      )}
      <div className="done-actions">
        <button className="btn-primary" onClick={onAgain}>
          {t.again}
        </button>
      </div>
    </div>
  );
}
