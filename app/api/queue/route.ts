import { NextResponse } from "next/server";
import { loadQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

/**
 * GET /api/queue — everything the panels need in one call:
 *  - drafts: status Draft, newest first, full bodies (approval queue)
 *  - manual: IG items Approved (post-manually lane), full bodies
 *  - approved: X/LinkedIn Approved, awaiting the publisher cron
 *  - queued: status Queued (in Typefully)
 *  - posted: last 10 Posted across platforms
 * Derivation lives in lib/queue.ts (shared with /api/agent/state).
 */
export async function GET() {
  try {
    return NextResponse.json(await loadQueue());
  } catch (err) {
    console.error("GET /api/queue failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Queue fetch failed" }, { status: 500 });
  }
}
