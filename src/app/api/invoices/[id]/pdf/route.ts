import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: RouteContext<"/api/invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  // id is a generated UUID; reject anything else so it can't escape the dir.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("Bad id", { status: 400 });
  }

  try {
    const bytes = await readFile(join(process.cwd(), "data", "uploads", `${id}.pdf`));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
