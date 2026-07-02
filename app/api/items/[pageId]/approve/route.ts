import { NextRequest } from "next/server";
import { approveItem } from "@/lib/actions";
import { handleAction, RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/**
 * Single-purpose approval endpoint — kept clean so a future Telegram webhook
 * (Phase 3) can call it directly.
 */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { pageId } = await params;
  return handleAction(() => approveItem(pageId));
}
