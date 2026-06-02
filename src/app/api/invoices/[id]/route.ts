import { NextResponse } from "next/server";
import { getInvoiceDetail } from "@/lib/repository";
import { invoiceDetailSchema } from "@/lib/api-contract";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  const { id } = await ctx.params;
  const detail = getInvoiceDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Shape the response through the shared contract: validates conformance and
  // strips server-only fields (rawText, timestamps, ids the client shouldn't see).
  return NextResponse.json(invoiceDetailSchema.parse(detail));
}
