import { NextResponse } from "next/server";
import { z } from "zod";
import { approveInvoice } from "@/lib/repository";

export const runtime = "nodejs";

const bodySchema = z.object({ expectedVersion: z.number().int() });

export async function POST(req: Request, ctx: RouteContext<"/api/invoices/[id]/approve">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "expectedVersion required" }, { status: 400 });
  }

  const result = approveInvoice(id, parsed.data.expectedVersion);
  if (result.ok) return NextResponse.json({ status: "approved", version: result.version });

  if (result.reason === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Stale version or no longer proposed — the client must re-fetch and re-review.
  return NextResponse.json(
    { error: result.reason, currentVersion: result.currentVersion },
    { status: 409 },
  );
}
