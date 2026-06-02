/**
 * The provided BAS chart of accounts.
 *
 * `kind` separates accounts the LLM is allowed to map line items to (`expense`)
 * from the structural accounts that code adds deterministically (input VAT,
 * supplier debt, bank). Keeping the LLM out of the structural accounts is what
 * guarantees it can never break double-entry balancing.
 */

export type AccountKind = "expense" | "vat" | "payable" | "bank";

export interface Account {
  konto: string;
  namn: string;
  kind: AccountKind;
}

export const ACCOUNTS: readonly Account[] = [
  { konto: "1930", namn: "Företagskonto", kind: "bank" },
  { konto: "2440", namn: "Leverantörsskulder", kind: "payable" },
  { konto: "2640", namn: "Ingående moms", kind: "vat" },
  { konto: "4010", namn: "Inköp material & varor", kind: "expense" },
  { konto: "5010", namn: "Lokalhyra", kind: "expense" },
  { konto: "5060", namn: "Driftskostnader lokal", kind: "expense" },
  { konto: "5220", namn: "Hyra inventarier", kind: "expense" },
  { konto: "5410", namn: "Förbrukningsinventarier", kind: "expense" },
  { konto: "5460", namn: "Förbrukningsmaterial", kind: "expense" },
  { konto: "5610", namn: "Kontorsmaterial", kind: "expense" },
  { konto: "5690", namn: "Övriga kontorskostnader", kind: "expense" },
  { konto: "6110", namn: "Kontorsförnödenheter", kind: "expense" },
  { konto: "6211", namn: "Fast telefoni", kind: "expense" },
  { konto: "6230", namn: "Datakommunikation", kind: "expense" },
  { konto: "6310", namn: "Företagsförsäkringar", kind: "expense" },
  { konto: "6530", namn: "IT-tjänster", kind: "expense" },
  { konto: "6540", namn: "IT-drift & hosting", kind: "expense" },
  { konto: "6570", namn: "Programvara, licenser", kind: "expense" },
  { konto: "6910", namn: "Licensavgifter & medlemskap", kind: "expense" },
  { konto: "7631", namn: "Personalmat & fika", kind: "expense" },
] as const;

export const ACCOUNT_BY_KONTO: Record<string, Account> = Object.fromEntries(
  ACCOUNTS.map((a) => [a.konto, a]),
);

/** Accounts the LLM is permitted to choose for a line item. */
export const EXPENSE_ACCOUNTS = ACCOUNTS.filter((a) => a.kind === "expense");

/** Structural accounts, referenced by code (never by the LLM). */
export const VAT_ACCOUNT = "2640";
export const PAYABLE_ACCOUNT = "2440";
export const BANK_ACCOUNT = "1930";

/**
 * Where a sub-krona öresavrundning is auto-posted to balance the entry. BAS 3740
 * "Öres- och kronutjämning" is the proper home but isn't in the provided chart,
 * so we fall back to the misc-expense account. Swap to 3740 if the chart gains it.
 */
export const ROUNDING_ACCOUNT = "5690";

/**
 * Description carried by the auto-posted rounding line. Shared by the assembler
 * (which writes it) and the UI (which uses konto + this to tell an auto rounding
 * row apart from a real expense the LLM happened to map to the same account).
 */
export const ROUNDING_DESCRIPTION = "Öresavrundning";

export const EXPENSE_KONTO_CODES = EXPENSE_ACCOUNTS.map((a) => a.konto) as [
  string,
  ...string[],
];
