import { NextResponse } from "next/server";
import { z } from "zod";
import { declineInvoice } from "@/lib/repository";

export const runtime = "nodejs";

const bodySchema = z.object({
  expectedVersion: z.number().int(),
  note: z.string().optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/invoices/[id]/decline">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "expectedVersion required" }, { status: 400 });
  }

  const result = declineInvoice(id, parsed.data.expectedVersion, parsed.data.note);
  if (result.ok) return NextResponse.json({ status: "declined", version: result.version });

  if (result.reason === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: result.reason, currentVersion: result.currentVersion },
    { status: 409 },
  );
}
