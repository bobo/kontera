"use client";

import type { Locale, Strings } from "@/lib/i18n";

type Screen = "upload" | "processing" | "review" | "done";

export function TopBar({
  t,
  locale,
  setLocale,
  screen,
  onOpenAccounts,
  onOpenLedger,
}: {
  t: Strings;
  locale: Locale;
  setLocale: (l: Locale) => void;
  screen: Screen;
  onOpenAccounts: () => void;
  onOpenLedger: () => void;
}) {
  const order: Record<Screen, number> = { upload: 0, processing: 1, review: 2, done: 3 };
  const cur = order[screen === "done" ? "review" : screen];
  const steps = [
    { k: "upload", n: "1", label: t.step_upload },
    { k: "processing", n: "2", label: t.step_read },
    { k: "review", n: "3", label: t.step_review },
  ] as const;

  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="wm-mark" aria-hidden="true" />
        <span className="wm-name">{t.appName}</span>
      </div>
      <nav className="steps" aria-label="Progress">
        {steps.map((s, i) => {
          const state = order[s.k] < cur ? "done" : order[s.k] === cur ? "current" : "todo";
          return (
            <div key={s.k} className={"step step-" + state}>
              <span className="step-dot">{state === "done" ? "✓" : s.n}</span>
              <span className="step-label">{s.label}</span>
              {i < 2 && <span className="step-line" aria-hidden="true" />}
            </div>
          );
        })}
      </nav>
      <div className="topbar-right">
        <button className="nav-btn" onClick={onOpenLedger}>
          {t.nav_ledger}
        </button>
        <button className="nav-btn" onClick={onOpenAccounts}>
          {t.nav_accounts}
        </button>
        <div className="lang-toggle" role="group" aria-label="Language">
          {(["en", "sv"] as const).map((code) => (
            <button
              key={code}
              className={"lang-opt" + (locale === code ? " is-active" : "")}
              onClick={() => setLocale(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        <span className="avatar" title="Accountant">
          KA
        </span>
      </div>
    </header>
  );
}
