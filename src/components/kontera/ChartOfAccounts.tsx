"use client";

import { ACCOUNTS } from "@/lib/accounts";
import type { Strings } from "@/lib/i18n";

type GroupKey = "assets" | "liabilities" | "goods" | "opex" | "personnel";
const GROUP_ORDER: GroupKey[] = ["assets", "liabilities", "goods", "opex", "personnel"];

function groupOf(konto: string): GroupKey {
  switch (konto[0]) {
    case "1":
      return "assets";
    case "2":
      return "liabilities";
    case "4":
      return "goods";
    case "7":
      return "personnel";
    default:
      return "opex"; // 5 & 6 — external operating costs
  }
}

export function ChartOfAccounts({ t }: { t: Strings }) {
  const labels: Record<GroupKey, string> = {
    assets: t.coa_assets,
    liabilities: t.coa_liabilities,
    goods: t.coa_goods,
    opex: t.coa_opex,
    personnel: t.coa_personnel,
  };

  return (
    <>
      {GROUP_ORDER.map((g) => {
        const rows = ACCOUNTS.filter((a) => groupOf(a.konto) === g);
        if (rows.length === 0) return null;
        return (
          <div className="coa-group" key={g}>
            <p className="coa-group-label">{labels[g]}</p>
            {rows.map((a) => (
              <div className="coa-row" key={a.konto}>
                <span className="coa-konto mono">{a.konto}</span>
                <span className="coa-namn">{a.namn}</span>
                {a.kind !== "expense" && <span className="coa-pill">{t.coa_auto}</span>}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
