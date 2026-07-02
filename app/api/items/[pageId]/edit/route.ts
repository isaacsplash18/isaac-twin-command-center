import { NextRequest } from "next/server";
import { editItem, ActionError } from "@/lib/actions";
import { handleAction, RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { pageId } = await params;
  return handleAction(async () => {
    let text: string;
    try {
      const body = await req.json();
      text = String(body?.text ?? "");
    } catch {
      throw new ActionError("Body must be JSON: { text: string }", 400);
    }
    return editItem(pageId, text);
  });
}
