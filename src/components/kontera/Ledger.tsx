"use client";

import { useEffect, useState } from "react";
import { formatSek } from "@/lib/money";
import { formatDate, type Locale, type Strings } from "@/lib/i18n";
import {
  invoiceDetailSchema,
  invoiceSummaryListSchema,
  type InvoiceSummary,
  type PostingView,
} from "@/lib/api-contract";

export function Ledger({ t, locale }: { t: Strings; locale: Locale }) {
  const [items, setItems] = useState<InvoiceSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [postings, setPostings] = useState<Record<string, PostingView[]>>({});

  useEffect(() => {
    fetch("/api/invoices")
      .then((r) => r.json())
      .then((d) => setItems(invoiceSummaryListSchema.parse(d.invoices ?? [])))
      .catch(() => setItems([]));
  }, []);

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!postings[id]) {
      const d = invoiceDetailSchema.parse(await fetch(`/api/invoices/${id}`).then((r) => r.json()));
      setPostings((prev) => ({ ...prev, [id]: d.postings }));
    }
  }

  const statusLabel = (s: InvoiceSummary["status"]) =>
    ({
      proposed: t.status_proposed,
      approved: t.status_approved,
      declined: t.status_declined,
      extracted: t.status_extracted,
    })[s];

  if (items && items.length === 0) {
    return <p className="ledger-empty">{t.ledger_empty}</p>;
  }

  return (
    <>
      {(items ?? []).map((inv) => (
        <div className="ledger-item" key={inv.id}>
          <button className="ledger-row" onClick={() => toggle(inv.id)}>
            <span>
              <span className="ledger-supplier">{inv.supplierName ?? "—"}</span>
              <span className="ledger-meta">
                {inv.invoiceNumber ? `#${inv.invoiceNumber} · ` : ""}
                {formatDate(inv.invoiceDate, locale)}
              </span>
            </span>
            <span className="ledger-right">
              <span className="ledger-amt mono">{formatSek(inv.grossOre)}</span>
              <span className={"status-pill status-" + inv.status}>{statusLabel(inv.status)}</span>
            </span>
          </button>
          {openId === inv.id && (
            <div className="ledger-detail">
              {(postings[inv.id] ?? []).map((p) => (
                <div className="ledger-post" key={p.id}>
                  <span className="ledger-post-acct">
                    <span className="mono">{p.konto}</span>
                    <span>{p.kontoNamn}</span>
                  </span>
                  <span className="mono">
                    {p.debitOre
                      ? `${t.col_debit[0]} ${formatSek(p.debitOre)}`
                      : `${t.col_credit[0]} ${formatSek(p.creditOre)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
