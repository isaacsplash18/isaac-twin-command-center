import { NextRequest } from "next/server";
import { rejectItem } from "@/lib/actions";
import { handleAction, RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { pageId } = await params;
  return handleAction(() => rejectItem(pageId));
}
