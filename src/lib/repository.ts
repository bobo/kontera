import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { InvoiceStatus } from "@/db/schema";
import { ACCOUNT_BY_KONTO, ROUNDING_ACCOUNT } from "./accounts";
import { formatOre } from "./money";
import { proposableStatus } from "./journal/assemble";
import type { PipelineResult } from "./pipeline";

const {
  invoices,
  lineItems,
  journalEntries,
  postings,
  enrichment,
  validationFlags,
  statusTransitions,
  llmRuns,
} = schema;

/** Persist a full pipeline result. The proposed entry is always stored as
 * revision 1 (with the LLM's mapping + rationale) so the accountant can review
 * and repair it — but the balance gate decides the status: a balanced draft is
 * `proposed` (approvable), an unbalanced one stays `extracted` and carries an
 * `unbalanced` flag until an edit brings it into balance. */
export function persistPipelineResult(
  result: PipelineResult,
  pdfFilename: string,
): string {
  return db.transaction((tx) => {
    const invoiceId = crypto.randomUUID();
    const balanced = result.journal.balanced;
    const status = proposableStatus(balanced, result.fxResolved);

    tx.insert(invoices)
      .values({
        id: invoiceId,
        status,
        version: 1,
        supplierName: result.invoice.supplierName ?? null,
        supplierOrgNr: result.invoice.supplierOrgNr ?? null,
        invoiceNumber: result.invoice.invoiceNumber ?? null,
        invoiceDate: result.invoice.invoiceDate ?? null,
        dueDate: result.invoice.dueDate ?? null,
        currency: result.originalCurrency,
        fxRate: result.fxRate,
        netOre: result.invoice.netOre,
        vatOre: result.invoice.vatOre,
        grossOre: result.invoice.grossOre,
        vatRate: result.invoice.vatRate ?? null,
        extractionMethod: result.method,
        extractionOk: result.selfCheck.ok,
        pdfFilename,
        rawText: result.rawText,
      })
      .run();

    const lineNoToId = new Map<number, string>();
    for (const li of result.invoice.lineItems) {
      const id = crypto.randomUUID();
      lineNoToId.set(li.lineNo, id);
      tx.insert(lineItems)
        .values({
          id,
          invoiceId,
          lineNo: li.lineNo,
          description: li.description,
          quantity: li.quantity ?? null,
          unitPriceOre: li.unitPriceOre ?? null,
          amountOre: li.amountOre,
        })
        .run();
    }

    // The draft is always persisted (balanced or not); only the status gate and
    // the `balanced` flag differ. An unbalanced draft is the accountant's
    // starting point for an edit-to-balance, not a discarded result.
    const entryId = crypto.randomUUID();
    tx.insert(journalEntries)
      .values({
        id: entryId,
        invoiceId,
        revision: 1,
        balanced,
        totalDebitOre: result.journal.totalDebitOre,
        totalCreditOre: result.journal.totalCreditOre,
        model: result.llmRuns[0]?.model ?? null,
      })
      .run();

    result.journal.postings.forEach((p, i) => {
      tx.insert(postings)
        .values({
          id: crypto.randomUUID(),
          journalEntryId: entryId,
          lineNo: i + 1,
          konto: p.konto,
          kontoNamn: p.kontoNamn,
          debitOre: p.debitOre,
          creditOre: p.creditOre,
          description: p.description,
          sourceLineItemId:
            p.sourceLineNo != null
              ? (lineNoToId.get(p.sourceLineNo) ?? null)
              : null,
          confidence: p.confidence,
          rationale: p.rationale,
        })
        .run();
    });

    tx.update(invoices)
      .set({ currentJournalEntryId: entryId })
      .where(eq(invoices.id, invoiceId))
      .run();

    if (!balanced) {
      tx.insert(validationFlags)
        .values({
          id: crypto.randomUUID(),
          invoiceId,
          severity: "warning",
          source: "deterministic",
          code: "unbalanced",
          message:
            "Could not produce a balanced journal entry from the extracted totals. Edit the entry to balance it before approving.",
        })
        .run();
    } else if (result.journal.roundingOre !== 0) {
      tx.insert(validationFlags)
        .values({
          id: crypto.randomUUID(),
          invoiceId,
          severity: "info",
          source: "deterministic",
          code: "rounding_adjustment",
          message: `Öresavrundning ${formatOre(Math.abs(result.journal.roundingOre))} kr posted automatically to ${ROUNDING_ACCOUNT}.`,
        })
        .run();
    }

    // Enrichment (non-authoritative). Skipped entirely when the enrichment call
    // failed — its absence is honest, an empty placeholder row would not be.
    if (result.enrichment) {
      tx.insert(enrichment)
        .values({
          id: crypto.randomUUID(),
          invoiceId,
          summary: result.enrichment.summary,
          tags: result.enrichment.tags,
          category: result.enrichment.category,
          supplierNormalized: result.enrichment.supplierNormalized ?? null,
          costType: result.enrichment.costType ?? null,
          periodStart: result.enrichment.periodStart ?? null,
          periodEnd: result.enrichment.periodEnd ?? null,
          model: result.llmRuns[0]?.model ?? null,
        })
        .run();
    }

    // Advisory flags: deterministic self-check issues + bookkeeping concerns +
    // LLM plausibility. All non-blocking — the human decides.
    for (const issue of [...result.selfCheck.issues, ...result.bookkeepingFlags]) {
      tx.insert(validationFlags)
        .values({
          id: crypto.randomUUID(),
          invoiceId,
          severity: issue.severity,
          source: "deterministic",
          code: issue.code,
          message: issue.message,
        })
        .run();
    }
    for (const f of result.flags.flags) {
      tx.insert(validationFlags)
        .values({
          id: crypto.randomUUID(),
          invoiceId,
          severity: f.severity,
          source: "llm",
          code: f.code,
          message: f.message,
        })
        .run();
    }

    tx.insert(statusTransitions)
      .values({
        id: crypto.randomUUID(),
        invoiceId,
        fromStatus: null,
        toStatus: status,
        atVersion: 1,
        note: `Extracted via ${result.method}`,
      })
      .run();

    for (const r of result.llmRuns) {
      tx.insert(llmRuns)
        .values({
          id: crypto.randomUUID(),
          invoiceId,
          purpose: r.purpose,
          model: r.model,
          request: r.request,
          response: r.response,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
        })
        .run();
    }

    return invoiceId;
  });
}

export type DecisionResult =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict" | "not_found" | "wrong_status"; currentVersion?: number };

/**
 * Optimistic-concurrency transition. The write only succeeds if the invoice is
 * still at `expectedVersion` and in one of `allowedFrom` — so an accountant can
 * only act on the exact version, in the exact state, they reviewed.
 */
function transition(
  id: string,
  expectedVersion: number,
  to: "approved" | "declined",
  allowedFrom: InvoiceStatus[],
  note?: string,
): DecisionResult {
  return db.transaction((tx) => {
    const current = tx
      .select({ version: invoices.version, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();

    if (!current) return { ok: false, reason: "not_found" } as const;
    if (!allowedFrom.includes(current.status)) {
      return { ok: false, reason: "wrong_status", currentVersion: current.version } as const;
    }
    if (current.version !== expectedVersion) {
      return { ok: false, reason: "conflict", currentVersion: current.version } as const;
    }

    const nextVersion = expectedVersion + 1;
    tx.update(invoices)
      .set({ status: to, version: nextVersion, updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.version, expectedVersion)))
      .run();

    tx.insert(statusTransitions)
      .values({
        id: crypto.randomUUID(),
        invoiceId: id,
        fromStatus: current.status,
        toStatus: to,
        atVersion: expectedVersion,
        note: note ?? null,
      })
      .run();

    return { ok: true, version: nextVersion } as const;
  });
}

export interface EditedPosting {
  konto: string;
  description: string | null;
  debitOre: number;
  creditOre: number;
}

export type SaveEntryResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "conflict" | "not_found" | "wrong_status" | "unbalanced" | "invalid";
      currentVersion?: number;
      message?: string;
    };

/**
 * Save an accountant-edited journal entry as a new immutable revision. Reuses
 * the balance gate (debits must equal credits) and the optimistic-lock version
 * check — an edit can only be saved against the version that was reviewed.
 *
 * Also the only way to give an `extracted` invoice (one extraction couldn't
 * balance) its first entry: a balanced edit promotes it to `proposed`, where it
 * can then be approved or declined like any other.
 */
export function saveEditedEntry(
  id: string,
  expectedVersion: number,
  edited: EditedPosting[],
): SaveEntryResult {
  // Validate accounts + balance before touching the DB.
  for (const p of edited) {
    if (!ACCOUNT_BY_KONTO[p.konto]) {
      return { ok: false, reason: "invalid", message: `Unknown account ${p.konto}` };
    }
    if (p.debitOre < 0 || p.creditOre < 0 || (p.debitOre > 0 && p.creditOre > 0)) {
      return { ok: false, reason: "invalid", message: "Each posting is a debit or a credit, not both" };
    }
  }
  const totalDebit = edited.reduce((s, p) => s + p.debitOre, 0);
  const totalCredit = edited.reduce((s, p) => s + p.creditOre, 0);
  if (totalDebit !== totalCredit || totalDebit === 0) {
    return { ok: false, reason: "unbalanced" };
  }

  return db.transaction((tx) => {
    const current = tx
      .select({ version: invoices.version, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (current.status !== "proposed" && current.status !== "extracted") {
      return { ok: false, reason: "wrong_status", currentVersion: current.version } as const;
    }
    if (current.version !== expectedVersion) {
      return { ok: false, reason: "conflict", currentVersion: current.version } as const;
    }

    const prevRevision =
      tx
        .select({ revision: journalEntries.revision })
        .from(journalEntries)
        .where(eq(journalEntries.invoiceId, id))
        .orderBy(desc(journalEntries.revision))
        .get()?.revision ?? 0;

    const entryId = crypto.randomUUID();
    const nextVersion = expectedVersion + 1;

    tx.insert(journalEntries)
      .values({
        id: entryId,
        invoiceId: id,
        revision: prevRevision + 1,
        balanced: true,
        totalDebitOre: totalDebit,
        totalCreditOre: totalCredit,
      })
      .run();

    edited.forEach((p, i) => {
      tx.insert(postings)
        .values({
          id: crypto.randomUUID(),
          journalEntryId: entryId,
          lineNo: i + 1,
          konto: p.konto,
          kontoNamn: ACCOUNT_BY_KONTO[p.konto].namn,
          debitOre: p.debitOre,
          creditOre: p.creditOre,
          description: p.description,
        })
        .run();
    });

    tx.update(invoices)
      .set({
        currentJournalEntryId: entryId,
        status: "proposed",
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, id), eq(invoices.version, expectedVersion)))
      .run();

    tx.insert(statusTransitions)
      .values({
        id: crypto.randomUUID(),
        invoiceId: id,
        fromStatus: current.status,
        toStatus: "proposed",
        atVersion: expectedVersion,
        note: `Edited entry (revision ${prevRevision + 1})`,
      })
      .run();

    return { ok: true, version: nextVersion } as const;
  });
}

// Approve needs a balanced entry to approve, so only from `proposed`. Decline
// also rejects a hopeless extraction that never balanced, so from `extracted` too.
export const approveInvoice = (id: string, expectedVersion: number) =>
  transition(id, expectedVersion, "approved", ["proposed"]);
export const declineInvoice = (id: string, expectedVersion: number, note?: string) =>
  transition(id, expectedVersion, "declined", ["proposed", "extracted"], note);

export function getInvoiceDetail(id: string) {
  const invoice = db.select().from(invoices).where(eq(invoices.id, id)).get();
  if (!invoice) return null;

  const items = db
    .select()
    .from(lineItems)
    .where(eq(lineItems.invoiceId, id))
    .orderBy(lineItems.lineNo)
    .all();

  const entry = invoice.currentJournalEntryId
    ? db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, invoice.currentJournalEntryId))
        .get()
    : null;

  const entryPostings = entry
    ? db
        .select()
        .from(postings)
        .where(eq(postings.journalEntryId, entry.id))
        .orderBy(postings.lineNo)
        .all()
    : [];

  const enr = db
    .select()
    .from(enrichment)
    .where(eq(enrichment.invoiceId, id))
    .orderBy(desc(enrichment.createdAt))
    .get();

  const flags = db
    .select()
    .from(validationFlags)
    .where(eq(validationFlags.invoiceId, id))
    .orderBy(validationFlags.createdAt)
    .all();

  const transitions = db
    .select()
    .from(statusTransitions)
    .where(eq(statusTransitions.invoiceId, id))
    .orderBy(statusTransitions.createdAt)
    .all();

  return { invoice, lineItems: items, journalEntry: entry, postings: entryPostings, enrichment: enr ?? null, flags, transitions };
}

export type InvoiceDetail = NonNullable<ReturnType<typeof getInvoiceDetail>>;

export function listInvoices() {
  return db
    .select({
      id: invoices.id,
      status: invoices.status,
      supplierName: invoices.supplierName,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      grossOre: invoices.grossOre,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .orderBy(desc(invoices.createdAt))
    .all();
}
