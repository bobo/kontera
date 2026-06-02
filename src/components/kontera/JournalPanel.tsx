"use client";

import { useState } from "react";
import {
  ACCOUNT_BY_KONTO,
  BANK_ACCOUNT,
  PAYABLE_ACCOUNT,
  ROUNDING_ACCOUNT,
  ROUNDING_DESCRIPTION,
  VAT_ACCOUNT,
} from "@/lib/accounts";
import { formatOre, formatSek } from "@/lib/money";
import { formatDate, type Locale, type Strings } from "@/lib/i18n";
import type { EnrichmentView, FlagView, InvoiceView } from "@/lib/api-contract";
import { AccountSelect } from "./AccountSelect";

export interface WorkingPosting {
  id: string;
  konto: string;
  description: string | null;
  debitOre: number;
  creditOre: number;
  confidence: number | null;
  rationale: string | null;
}

const STRUCTURAL = new Set([VAT_ACCOUNT, PAYABLE_ACCOUNT, BANK_ACCOUNT]);
// `locked` = derived from fixed facts, not editable (VAT, payable, bank).
const isLocked = (konto: string) => STRUCTURAL.has(konto);
// The auto-posted öresavrundning line: shown in the auto-generated band like the
// structural rows, but still editable (the accountant may tweak or drop it).
const isAutoRounding = (p: WorkingPosting) =>
  p.konto === ROUNDING_ACCOUNT && p.description === ROUNDING_DESCRIPTION;

const oreToText = (ore: number) => (ore ? String(ore / 100).replace(".", ",") : "");
const textToOre = (text: string): number => {
  const n = parseFloat(text.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Amount field that keeps its own text state while focused, so a half-typed
 * decimal ("239," or "0,2") survives keystrokes. A value derived straight from
 * the integer öre would re-render "239" the instant you type the comma, making
 * decimals impossible to enter. We resync from props only when the external
 * value changes to something the current text doesn't already represent.
 */
function AmountInput({
  ore,
  onChange,
}: {
  ore: number;
  onChange: (ore: number) => void;
}) {
  const [text, setText] = useState(() => oreToText(ore));
  const [focused, setFocused] = useState(false);
  // Resync from props when the external value changes to something the current
  // text doesn't represent — adjusting state during render (React's prescribed
  // alternative to a setState-in-effect) so a keystroke never gets clobbered.
  const [seenOre, setSeenOre] = useState(ore);
  if (ore !== seenOre) {
    setSeenOre(ore);
    if (textToOre(text) !== ore) setText(oreToText(ore));
  }

  // Show the accounting-formatted amount (899,00) at rest, the raw editable
  // number (899) while typing — so edit mode matches the locked rows visually.
  return (
    <input
      className="num-input mono"
      inputMode="decimal"
      value={focused ? text : ore ? formatOre(ore) : ""}
      placeholder="—"
      onFocus={() => {
        setText(oreToText(ore));
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(textToOre(e.target.value));
      }}
    />
  );
}

function ConfidenceDot({ value, t }: { value: number; t: Strings }) {
  const cls = value >= 0.95 ? "high" : value >= 0.85 ? "mid" : "low";
  const pct = Math.round(value * 100);
  return (
    <span className={"conf conf-" + cls} title={`${pct}% ${t.confidence}`}>
      <span className="conf-bead" />
      {pct}%
    </span>
  );
}

function PostingRow({
  p,
  t,
  editing,
  onChange,
  onRemove,
}: {
  p: WorkingPosting;
  t: Strings;
  editing: boolean;
  onChange: (p: WorkingPosting) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const locked = isLocked(p.konto);
  // Auto-generated rows (structural + the rounding line) share the banded look
  // and the "Autogenererad" pill; only `locked` ones are non-editable.
  const auto = locked || isAutoRounding(p);

  const amountCell = (field: "debitOre" | "creditOre") => {
    const ore = p[field];
    if (editing && !locked) {
      return (
        <AmountInput
          ore={ore}
          onChange={(v) => onChange({ ...p, [field]: v })}
        />
      );
    }
    return <span className="mono">{ore ? formatOre(ore) : <span className="dash">—</span>}</span>;
  };

  return (
    <>
      <tr className={auto ? "post-row locked" : "post-row"}>
        <td>
          {editing && !locked ? (
            <AccountSelect
              value={p.konto}
              onChange={(konto) => onChange({ ...p, konto })}
            />
          ) : (
            <div className="acct-static">
              <span className="acct-konto mono">{p.konto}</span>
              <span className="acct-namn">{ACCOUNT_BY_KONTO[p.konto]?.namn ?? ""}</span>
            </div>
          )}
        </td>
        <td>
          <div className="post-desc-main">{p.description}</div>
          <div className="post-flags">
            {auto ? (
              <span className="lock-pill">{t.lock_note}</span>
            ) : p.confidence != null ? (
              <ConfidenceDot value={p.confidence} t={t} />
            ) : null}
            {!locked && p.rationale && (
              <button className="rat-toggle" onClick={() => setOpen((o) => !o)}>
                {t.rationale_label}
              </button>
            )}
          </div>
        </td>
        <td className="post-amt ta-r">{amountCell("debitOre")}</td>
        <td className="post-amt ta-r">{amountCell("creditOre")}</td>
        <td>
          {editing && !locked && (
            <button className="row-x" onClick={() => onRemove(p.id)} title="Remove" aria-label="Remove">
              ×
            </button>
          )}
        </td>
      </tr>
      {open && p.rationale && (
        <tr className="rat-row">
          <td />
          <td colSpan={4}>
            <div className="rat-note">
              <span className="rat-quote">“</span>
              {p.rationale}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function JournalPanel({
  invoice,
  postings,
  setPostings,
  flags,
  enrichment,
  editing,
  setEditing,
  t,
  locale,
}: {
  invoice: InvoiceView;
  postings: WorkingPosting[];
  setPostings: (fn: (ps: WorkingPosting[]) => WorkingPosting[]) => void;
  flags: FlagView[];
  enrichment: EnrichmentView | null;
  editing: boolean;
  setEditing: (fn: (e: boolean) => boolean) => void;
  t: Strings;
  locale: Locale;
}) {
  const totalDebit = postings.reduce((s, p) => s + p.debitOre, 0);
  const totalCredit = postings.reduce((s, p) => s + p.creditOre, 0);
  const diff = totalDebit - totalCredit;
  const balanced = diff === 0 && totalDebit > 0;

  // Only offer the one-click fix for sub-krona imbalances (genuine
  // öresavrundning). A larger gap means a misread amount the accountant should
  // correct at the source — silently plugging it would hide the real error.
  const ROUNDING_LIMIT_ORE = 100;
  const canRound = diff !== 0 && Math.abs(diff) <= ROUNDING_LIMIT_ORE;

  const update = (np: WorkingPosting) =>
    setPostings((ps) => ps.map((p) => (p.id === np.id ? np : p)));
  const remove = (id: string) => setPostings((ps) => ps.filter((p) => p.id !== id));
  const addRounding = () =>
    setPostings((ps) => {
      const amt = Math.abs(diff);
      const np: WorkingPosting = {
        id: "round-" + ps.length,
        konto: "5690",
        description: locale === "sv" ? "Öresavrundning" : "Rounding",
        // diff = debit − credit: if debits run ahead, the fix is a credit.
        debitOre: diff < 0 ? amt : 0,
        creditOre: diff > 0 ? amt : 0,
        confidence: null,
        rationale: null,
      };
      const idx = ps.findIndex((p) => isLocked(p.konto));
      const at = idx === -1 ? ps.length : idx;
      return [...ps.slice(0, at), np, ...ps.slice(at)];
    });
  const add = () =>
    setPostings((ps) => {
      const idx = ps.findIndex((p) => isLocked(p.konto));
      const np: WorkingPosting = {
        id: "new-" + ps.length + "-" + Math.max(1, ps.length),
        konto: "5690",
        description: "",
        debitOre: 0,
        creditOre: 0,
        confidence: null,
        rationale: null,
      };
      const at = idx === -1 ? ps.length : idx;
      return [...ps.slice(0, at), np, ...ps.slice(at)];
    });

  return (
    <section className="journal">
      <header className="panel-head">
        <div className="panel-head-l">
          <h2 className="panel-title">{t.rev_journal}</h2>
          <span className="ai-badge">
            <span className="ai-spark" aria-hidden="true" />
            {t.rev_draft}
          </span>
        </div>
        <button
          className={"link-btn" + (editing ? " is-on" : "")}
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? t.edit_done : t.edit}
        </button>
      </header>

      <div className="journal-meta">
        <span>
          {t.rev_invoice_date} <b>{formatDate(invoice.invoiceDate, locale)}</b>
        </span>
        <span>
          {t.rev_total} <b className="mono">{formatSek(invoice.grossOre)}</b>
        </span>
      </div>

      <div className="post-table-wrap">
        <table className="post-table">
          <thead>
            <tr>
              <th className="ta-l">{t.col_account}</th>
              <th className="ta-l">{t.col_desc}</th>
              <th className="ta-r">{t.col_debit}</th>
              <th className="ta-r">{t.col_credit}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {postings.map((p) => (
              <PostingRow
                key={p.id}
                p={p}
                t={t}
                editing={editing}
                onChange={update}
                onRemove={remove}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="totals-row">
              <td />
              <td className="ta-l totals-label">{t.totals}</td>
              <td className="ta-r mono totals-num">{formatOre(totalDebit)}</td>
              <td className="ta-r mono totals-num">{formatOre(totalCredit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="journal-foot">
        {editing && (
          <button className="add-post" onClick={add}>
            + {t.add_posting}
          </button>
        )}
        {editing && canRound && (
          <button className="add-post" onClick={addRounding}>
            + {t.add_rounding} ({formatSek(Math.abs(diff))})
          </button>
        )}
        <span className={"balance " + (balanced ? "ok" : "off")}>
          {balanced ? (
            <>
              <span className="bal-check" aria-hidden="true">
                ✓
              </span>
              {t.balanced}
            </>
          ) : (
            <>
              <span className="bal-warn" aria-hidden="true">
                !
              </span>
              {t.off_by} {formatSek(Math.abs(diff))}
            </>
          )}
        </span>
      </div>

      {flags.length > 0 && (
        <div className="flags">
          {flags.map((f) => (
            <div key={f.id} className={"flag flag-" + f.severity}>
              <span className="flag-bead" />
              <span>
                <span className="flag-src">{f.source}</span> {f.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {enrichment?.tags && enrichment.tags.length > 0 && (
        <div className="tags">
          {enrichment.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
