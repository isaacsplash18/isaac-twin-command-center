import { NextRequest } from "next/server";
import { publishOne } from "@/lib/publisher";
import { handleAction, RouteParams } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

/** Manual override: push one Approved item into the next free Typefully slot now. */
export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { pageId } = await params;
  return handleAction(() => publishOne(pageId));
}
