"use client";

import { useState } from "react";
import { I18N, type Locale } from "@/lib/i18n";
import { invoiceDetailSchema, type InvoiceDetail } from "@/lib/api-contract";
import { TopBar } from "./TopBar";
import { UploadScreen } from "./UploadScreen";
import { ProcessingScreen } from "./ProcessingScreen";
import { BillDocument } from "./BillDocument";
import { JournalPanel, type WorkingPosting } from "./JournalPanel";
import { DoneScreen } from "./DoneScreen";
import { Drawer } from "./Drawer";
import { ChartOfAccounts } from "./ChartOfAccounts";
import { Ledger } from "./Ledger";

type Screen = "upload" | "processing" | "review" | "done";

function toWorking(d: InvoiceDetail): WorkingPosting[] {
  return d.postings.map((p) => ({
    id: p.id,
    konto: p.konto,
    description: p.description,
    debitOre: p.debitOre,
    creditOre: p.creditOre,
    confidence: p.confidence,
    rationale: p.rationale,
  }));
}

export function KonteraApp() {
  const [locale, setLocale] = useState<Locale>("sv");
  const [screen, setScreen] = useState<Screen>("upload");
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [postings, setPostingsState] = useState<WorkingPosting[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [approved, setApproved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<null | "accounts" | "ledger">(null);
  const t = I18N[locale];

  const setPostings = (fn: (ps: WorkingPosting[]) => WorkingPosting[]) => {
    setPostingsState(fn);
    setDirty(true);
  };

  async function loadDetail(id: string): Promise<InvoiceDetail> {
    const res = await fetch(`/api/invoices/${id}`);
    if (!res.ok) throw new Error("Failed to load");
    return invoiceDetailSchema.parse(await res.json());
  }

  function messageForCode(code: unknown): string {
    switch (code) {
      case "not_pdf":
        return t.err_not_pdf;
      case "empty_file":
        return t.err_empty_file;
      case "file_too_large":
        return t.err_file_too_large;
      case "extraction_failed":
        return t.err_extraction_failed;
      case "ai_auth":
        return t.err_ai_auth;
      case "ai_unavailable":
        return t.err_ai_unavailable;
      default:
        return t.upload_failed;
    }
  }

  async function handleFile(file: File) {
    setError(null);
    setScreen("processing");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/invoices", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(messageForCode(json.code));
        setScreen("upload");
        return;
      }
      const d = await loadDetail(json.id);
      setDetail(d);
      setPostingsState(toWorking(d));
      setDirty(false);
      // An unbalanced draft needs fixing before approval — land in edit mode.
      setEditing(d.invoice.status === "extracted");
      setNotice(null);
      setScreen("review");
    } catch {
      setError(t.upload_failed);
      setScreen("upload");
    }
  }

  async function refresh(id: string) {
    const d = await loadDetail(id);
    setDetail(d);
    setPostingsState(toWorking(d));
    setDirty(false);
    setEditing(d.invoice.status === "extracted");
  }

  const totalDebit = postings.reduce((s, p) => s + p.debitOre, 0);
  const totalCredit = postings.reduce((s, p) => s + p.creditOre, 0);
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  async function approve() {
    if (!detail || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      let version = detail.invoice.version;

      if (dirty) {
        const saveRes = await fetch(`/api/invoices/${detail.invoice.id}/entry`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: version,
            postings: postings.map((p) => ({
              konto: p.konto,
              description: p.description,
              debitOre: p.debitOre,
              creditOre: p.creditOre,
            })),
          }),
        });
        const saveJson = await saveRes.json();
        if (saveRes.status === 409) {
          setNotice(t.save_failed);
          await refresh(detail.invoice.id);
          return;
        }
        if (!saveRes.ok) {
          setNotice(saveJson.message ?? saveJson.error ?? "error");
          return;
        }
        version = saveJson.version;
      }

      const res = await fetch(`/api/invoices/${detail.invoice.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version }),
      });
      if (res.status === 409) {
        setNotice(t.save_failed);
        await refresh(detail.invoice.id);
        return;
      }
      if (!res.ok) throw new Error("approve failed");
      setApproved(true);
      setScreen("done");
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (!detail || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/invoices/${detail.invoice.id}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: detail.invoice.version }),
      });
      if (res.status === 409) {
        setNotice(t.save_failed);
        await refresh(detail.invoice.id);
        return;
      }
      if (!res.ok) throw new Error("decline failed");
      setApproved(false);
      setScreen("done");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDetail(null);
    setError(null);
    setNotice(null);
    setScreen("upload");
  }

  return (
    <div className="app">
      <TopBar
        t={t}
        locale={locale}
        setLocale={setLocale}
        screen={screen}
        onOpenAccounts={() => setPanel("accounts")}
        onOpenLedger={() => setPanel("ledger")}
      />
      <main className="stage">
        {screen === "upload" && <UploadScreen t={t} error={error} onFile={handleFile} />}
        {screen === "processing" && <ProcessingScreen t={t} />}
        {screen === "review" && detail && (
          <>
            <div className="review-top">
              <div>
                <div className="rev-kicker">{t.rev_kicker}</div>
                <h1 className="rev-h1">{detail.invoice.supplierName ?? "—"}</h1>
                {detail.invoice.status === "extracted" && (
                  <div className="needs-balance">
                    <strong>{t.needs_balance_title}</strong> {t.needs_balance_hint}
                  </div>
                )}
                {notice && <div className="upload-error">{notice}</div>}
              </div>
              <div className="rev-actions">
                <button className="btn-ghost" onClick={decline} disabled={busy}>
                  {t.decline}
                </button>
                <button className="btn-primary" onClick={approve} disabled={busy || !balanced}>
                  {t.approve}
                </button>
              </div>
            </div>
            <div className="review">
              <section className="doc-pane">
                <header className="panel-head">
                  <h2 className="panel-title">{t.rev_doc}</h2>
                  <a
                    className="doc-pill"
                    href={`/api/invoices/${detail.invoice.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.view_pdf} ↗
                  </a>
                </header>
                <div className="doc-scroll">
                  <BillDocument
                    invoice={detail.invoice}
                    lineItems={detail.lineItems}
                    t={t}
                    locale={locale}
                  />
                </div>
              </section>
              <JournalPanel
                invoice={detail.invoice}
                postings={postings}
                setPostings={setPostings}
                flags={detail.flags}
                enrichment={detail.enrichment}
                editing={editing}
                setEditing={setEditing}
                t={t}
                locale={locale}
              />
            </div>
          </>
        )}
        {screen === "done" && detail && (
          <DoneScreen
            t={t}
            locale={locale}
            approved={approved}
            invoice={detail.invoice}
            onAgain={reset}
          />
        )}
      </main>

      {panel === "accounts" && (
        <Drawer title={t.coa_title} sub={t.coa_sub} onClose={() => setPanel(null)}>
          <ChartOfAccounts t={t} />
        </Drawer>
      )}
      {panel === "ledger" && (
        <Drawer title={t.ledger_title} sub={t.ledger_sub} onClose={() => setPanel(null)}>
          <Ledger t={t} locale={locale} />
        </Drawer>
      )}
    </div>
  );
}
