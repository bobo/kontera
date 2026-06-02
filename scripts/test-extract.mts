import { readFileSync } from "node:fs";
import { extractFromTextLayer } from "../src/lib/extract/text-layer.ts";
import { selfCheckInvoice } from "../src/lib/extract/self-check.ts";

const path = process.argv[2] ?? "./simple_invoice.pdf";
const data = new Uint8Array(readFileSync(path));
const res = await extractFromTextLayer(data);
if (!res) {
  console.log("No text layer / extraction failed");
  process.exit(1);
}
console.log("=== RAW TEXT ===\n" + res.rawText);
console.log("\n=== INVOICE ===");
console.dir(res.invoice, { depth: null });
console.log("\n=== SELF CHECK ===");
console.dir(selfCheckInvoice(res.invoice), { depth: null });
