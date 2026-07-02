import { NextResponse } from "next/server";
import { PLATFORMS } from "@/lib/config";
import { ContentItem, itemsWithStatus } from "@/lib/items";

export const dynamic = "force-dynamic";

/**
 * GET /api/queue — everything the panels need in one call:
 *  - drafts: status Draft, newest first, full bodies (approval queue)
 *  - manual: IG items Approved (post-manually lane), full bodies
 *  - approved: X/LinkedIn Approved, awaiting the publisher cron
 *  - queued: status Queued (in Typefully)
 *  - posted: last 10 Posted across platforms
 */
export async function GET() {
  try {
    const drafts: ContentItem[] = [];
    const manual: ContentItem[] = [];
    const approved: ContentItem[] = [];
    const queued: ContentItem[] = [];
    const posted: ContentItem[] = [];

    await Promise.all(
      PLATFORMS.map(async (p) => {
        const [d, a, q, po] = await Promise.all([
          itemsWithStatus(p, "Draft", { withBody: true, limit: 20 }),
          itemsWithStatus(p, "Approved", { withBody: p.autoPublish ? false : true, limit: 20 }),
          itemsWithStatus(p, "Queued", { limit: 20 }),
          itemsWithStatus(p, "Posted", { limit: 10 }),
        ]);
        drafts.push(...d);
        (p.autoPublish ? approved : manual).push(...a);
        queued.push(...q);
        posted.push(...po);
      })
    );

    const byCreatedDesc = (a: ContentItem, b: ContentItem) => b.createdTime.localeCompare(a.createdTime);
    drafts.sort(byCreatedDesc);
    manual.sort(byCreatedDesc);
    approved.sort(byCreatedDesc);
    queued.sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999"));
    posted.sort((a, b) => b.lastEditedTime.localeCompare(a.lastEditedTime));

    return NextResponse.json({
      drafts,
      manual,
      approved,
      queued,
      posted: posted.slice(0, 10),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /api/queue failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Queue fetch failed" }, { status: 500 });
  }
}
