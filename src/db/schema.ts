import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).default(
    sql`(unixepoch() * 1000)`,
  );

export type InvoiceStatus = "extracted" | "proposed" | "approved" | "declined";

/**
 * Aggregate root. `version` is the optimistic-concurrency token: every
 * state-changing operation bumps it, and approve/decline/edit are conditional
 * writes on the version the client last saw.
 */
export const invoices = sqliteTable("invoices", {
  id: id(),
  status: text("status").$type<InvoiceStatus>().notNull().default("extracted"),
  version: integer("version").notNull().default(1),

  // --- Extracted facts (immutable once extracted) ---
  supplierName: text("supplier_name"),
  supplierOrgNr: text("supplier_org_nr"),
  invoiceNumber: text("invoice_number"),
  invoiceDate: text("invoice_date"),
  dueDate: text("due_date"),
  // Original invoice currency; all *_ore amounts below are stored in SEK.
  currency: text("currency").notNull().default("SEK"),
  fxRate: real("fx_rate").notNull().default(1),
  netOre: integer("net_ore").notNull(),
  vatOre: integer("vat_ore").notNull(),
  grossOre: integer("gross_ore").notNull(),
  vatRate: real("vat_rate"),

  // How Layer 1 obtained the data, and whether its math self-check passed.
  extractionMethod: text("extraction_method")
    .$type<"text-layer" | "llm-vision">()
    .notNull(),
  extractionOk: integer("extraction_ok", { mode: "boolean" })
    .notNull()
    .default(true),

  pdfFilename: text("pdf_filename"),
  rawText: text("raw_text"),

  currentJournalEntryId: text("current_journal_entry_id"),

  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(unixepoch() * 1000)`,
  ),
});

/** Extracted line items — facts, not accounting. */
export const lineItems = sqliteTable("line_items", {
  id: id(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  lineNo: integer("line_no").notNull(),
  description: text("description").notNull(),
  quantity: real("quantity"),
  unitPriceOre: integer("unit_price_ore"),
  amountOre: integer("amount_ore").notNull(),
});

/** Immutable, per-invoice revision of the proposed entry. An edit appends a new revision. */
export const journalEntries = sqliteTable("journal_entries", {
  id: id(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  revision: integer("revision").notNull().default(1),
  balanced: integer("balanced", { mode: "boolean" }).notNull(),
  totalDebitOre: integer("total_debit_ore").notNull(),
  totalCreditOre: integer("total_credit_ore").notNull(),
  model: text("model"),
  createdAt: createdAt(),
});

export const postings = sqliteTable("postings", {
  id: id(),
  journalEntryId: text("journal_entry_id")
    .notNull()
    .references(() => journalEntries.id),
  lineNo: integer("line_no").notNull(),
  konto: text("konto").notNull(),
  kontoNamn: text("konto_namn").notNull(),
  debitOre: integer("debit_ore").notNull().default(0),
  creditOre: integer("credit_ore").notNull().default(0),
  description: text("description"),
  sourceLineItemId: text("source_line_item_id"),
  // LLM mapping signal for cost-line postings; null for structural postings.
  confidence: real("confidence"),
  rationale: text("rationale"),
});

/** LLM semantic enrichment — non-authoritative, regenerable. */
export const enrichment = sqliteTable("enrichment", {
  id: id(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  summary: text("summary"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  category: text("category"),
  supplierNormalized: text("supplier_normalized"),
  costType: text("cost_type").$type<"one-off" | "recurring" | null>(),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  model: text("model"),
  createdAt: createdAt(),
});

/** Advisory warnings. Never block persistence — the human decides. */
export const validationFlags = sqliteTable("validation_flags", {
  id: id(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  journalEntryId: text("journal_entry_id"),
  severity: text("severity").$type<"info" | "warning">().notNull(),
  source: text("source").$type<"deterministic" | "llm">().notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  createdAt: createdAt(),
});

/** Append-only audit trail of state transitions. */
export const statusTransitions = sqliteTable("status_transitions", {
  id: id(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  atVersion: integer("at_version").notNull(),
  note: text("note"),
  createdAt: createdAt(),
});

/** Raw LLM request/response, kept for replay and debugging. */
export const llmRuns = sqliteTable("llm_runs", {
  id: id(),
  invoiceId: text("invoice_id"),
  purpose: text("purpose")
    .$type<"mapping" | "enrichment" | "validation" | "extraction">()
    .notNull(),
  model: text("model").notNull(),
  request: text("request", { mode: "json" }),
  response: text("response", { mode: "json" }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
});
