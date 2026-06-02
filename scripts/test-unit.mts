/**
 * Fast offline unit tests for pure domain logic (no DB, no LLM, no network).
 *
 *   npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { proposableStatus } from "../src/lib/journal/assemble.ts";
import { detectBookkeepingConcerns } from "../src/lib/extract/self-check.ts";
import type { ExtractedInvoice } from "../src/lib/types.ts";

function invoice(over: Partial<ExtractedInvoice>): ExtractedInvoice {
  return {
    currency: "SEK",
    lineItems: [{ lineNo: 1, description: "x", amountOre: 10000 }],
    netOre: 10000,
    vatOre: 2500,
    grossOre: 12500,
    ...over,
  };
}

test("proposableStatus: balanced + FX resolved is approvable", () => {
  assert.equal(proposableStatus(true, true), "proposed");
});

test("proposableStatus: balanced but FX unresolved is NOT approvable", () => {
  // A foreign invoice with no available rate balances only because its amounts
  // are still in the foreign currency — booking that as SEK would be wrong, so
  // it must stay `extracted` rather than becoming approvable.
  assert.equal(proposableStatus(true, false), "extracted");
});

test("proposableStatus: an unbalanced entry is never approvable", () => {
  assert.equal(proposableStatus(false, true), "extracted");
  assert.equal(proposableStatus(false, false), "extracted");
});

test("bookkeeping: foreign 0-VAT invoice is flagged as suspected reverse charge (warning)", () => {
  const issues = detectBookkeepingConcerns(
    invoice({ currency: "EUR", vatOre: 0, grossOre: 10000 }),
    "EUR",
  );
  const flag = issues.find((i) => i.code === "reverse_charge_suspected");
  assert.ok(flag, "expected a reverse_charge_suspected flag");
  assert.equal(flag.severity, "warning");
});

test("bookkeeping: domestic 0-VAT invoice is a low-severity zero_vat note", () => {
  const issues = detectBookkeepingConcerns(
    invoice({ currency: "SEK", vatOre: 0, grossOre: 10000 }),
    "SEK",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "zero_vat");
  assert.equal(issues[0].severity, "info");
});

test("bookkeeping: an ordinary VAT invoice raises no concern", () => {
  assert.deepEqual(detectBookkeepingConcerns(invoice({}), "SEK"), []);
});
