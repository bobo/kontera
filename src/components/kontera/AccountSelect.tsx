"use client";

import { useEffect, useRef, useState } from "react";
import { ACCOUNTS, ACCOUNT_BY_KONTO } from "@/lib/accounts";

/**
 * Custom account dropdown (the design replaced a native <select> with this so
 * the full BAS account name always shows). Menu is positioned with fixed
 * coordinates so it escapes the table's stacking/overflow.
 */
export function AccountSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (konto: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const trigRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const reposition = () => {
      if (trigRef.current) setRect(trigRef.current.getBoundingClientRect());
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const toggle = () => {
    if (!open && trigRef.current) setRect(trigRef.current.getBoundingClientRect());
    setOpen((o) => !o);
  };

  const namn = ACCOUNT_BY_KONTO[value]?.namn ?? "";
  const menuStyle: React.CSSProperties = rect
    ? { position: "fixed", top: rect.bottom + 5, left: rect.left, minWidth: Math.max(rect.width, 248) }
    : {};

  return (
    <div className="acct-select" ref={ref}>
      <button
        ref={trigRef}
        className={"acct-trigger" + (open ? " is-open" : "")}
        onClick={toggle}
        type="button"
      >
        <span className="acct-konto mono">{value}</span>
        <span className="acct-trigger-namn">{namn}</span>
        <span className="acct-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="acct-menu" style={menuStyle}>
          {ACCOUNTS.map((a) => (
            <button
              key={a.konto}
              type="button"
              className={"acct-opt" + (a.konto === value ? " is-sel" : "")}
              onClick={() => {
                onChange(a.konto);
                setOpen(false);
              }}
            >
              <span className="acct-konto mono">{a.konto}</span>
              <span className="acct-opt-namn">{a.namn}</span>
              {a.konto === value && (
                <span className="acct-opt-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
