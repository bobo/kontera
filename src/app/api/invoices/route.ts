import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runPipeline } from "@/lib/pipeline";
import { persistPipelineResult, listInvoices } from "@/lib/repository";
import { PipelineError, statusForCode } from "@/lib/errors";
import { invoiceSummaryListSchema } from "@/lib/api-contract";

const UPLOAD_DIR = join(process.cwd(), "data", "uploads");

// Cap matches the UI hint. The whole file is read into memory and base64-inflated
// ~1.33× to ship to the LLM, so an unbounded upload is an easy OOM / cost bomb.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  return NextResponse.json({ invoices: invoiceSummaryListSchema.parse(listInvoices()) });
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { code: "empty_file", error: "No file uploaded" },
      { status: 400 },
    );
  }
  if (file.type && file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
    return NextResponse.json(
      { code: "not_pdf", error: "File must be a PDF" },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { code: "file_too_large", error: "PDF exceeds the 10 MB limit" },
      { status: 413 },
    );
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // The content-type and filename are client-controlled; the bytes are not.
  // Require the %PDF magic so a renamed/relabelled non-PDF is rejected up front.
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 || // %
    bytes[1] !== 0x50 || // P
    bytes[2] !== 0x44 || // D
    bytes[3] !== 0x46 // F
  ) {
    return NextResponse.json(
      { code: "not_pdf", error: "File is not a valid PDF" },
      { status: 400 },
    );
  }

  // pdfjs detaches the ArrayBuffer it parses, so keep an independent copy for disk.
  const forDisk = new Uint8Array(buffer.slice(0));

  try {
    const result = await runPipeline(bytes);
    const id = persistPipelineResult(result, file.name);

    // Keep the original PDF so the accountant can view the bill alongside the entry.
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(join(UPLOAD_DIR, `${id}.pdf`), forDisk);

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Pipeline failed:", err);
    const code = err instanceof PipelineError ? err.code : "processing_failed";
    return NextResponse.json(
      { code, error: err instanceof Error ? err.message : "Processing failed" },
      { status: statusForCode(code) },
    );
  }
}
