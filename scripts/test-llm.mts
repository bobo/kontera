import { readFileSync } from "node:fs";
import { extractFromTextLayer } from "../src/lib/extract/text-layer.ts";
import {
  mapAccounts,
  enrichInvoice,
  reviewPlausibility,
} from "../src/lib/llm/tasks.ts";

const data = new Uint8Array(readFileSync("./simple_invoice.pdf"));
const res = await extractFromTextLayer(data);
if (!res) throw new Error("extraction failed");

const map = await mapAccounts(res.invoice);
console.log("=== MAPPING ===");
console.dir(map.data, { depth: null });
console.log("usage:", map.usage);

const enr = await enrichInvoice(res.invoice);
console.log("\n=== ENRICHMENT ===");
console.dir(enr.data, { depth: null });

const flags = await reviewPlausibility(res.invoice, map.data);
console.log("\n=== FLAGS ===");
console.dir(flags.data, { depth: null });
