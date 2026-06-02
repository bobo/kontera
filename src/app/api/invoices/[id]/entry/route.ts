import { NextResponse } from "next/server";
import { z } from "zod";
import { saveEditedEntry } from "@/lib/repository";

export const runtime = "nodejs";

const bodySchema = z.object({
  expectedVersion: z.number().int(),
  postings: z
    .array(
      z.object({
        konto: z.string(),
        description: z.string().nullable().default(null),
        debitOre: z.number().int().nonnegative(),
        creditOre: z.number().int().nonnegative(),
      }),
    )
    .min(2),
});

export async function PUT(req: Request, ctx: RouteContext<"/api/invoices/[id]/entry">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const result = saveEditedEntry(id, parsed.data.expectedVersion, parsed.data.postings);
  if (result.ok) return NextResponse.json({ version: result.version });

  if (result.reason === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.reason === "unbalanced" || result.reason === "invalid") {
    return NextResponse.json(
      { error: result.reason, message: result.message },
      { status: 422 },
    );
  }
  return NextResponse.json(
    { error: result.reason, currentVersion: result.currentVersion },
    { status: 409 },
  );
}
