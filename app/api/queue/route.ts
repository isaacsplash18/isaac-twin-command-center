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

    const errors: string[] = [];
    // Each lane degrades independently: pre-migration DBs lack the Queued/
    // Rejected options and Notion 400s on filters for unknown select options.
    const lane = (p: (typeof PLATFORMS)[number], status: string, opts: Parameters<typeof itemsWithStatus>[2]) =>
      itemsWithStatus(p, status, opts).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        // Missing select option = schema not migrated yet; not a failure.
        if (!message.includes("not found for property")) errors.push(`${p.label}/${status}: ${message}`);
        return [];
      });

    await Promise.all(
      PLATFORMS.map(async (p) => {
        const [d, a, q, po] = await Promise.all([
          lane(p, "Draft", { withBody: true, limit: 20 }),
          lane(p, "Approved", { withBody: p.autoPublish ? false : true, limit: 20 }),
          lane(p, "Queued", { limit: 20 }),
          lane(p, "Posted", { limit: 10 }),
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
      ...(errors.length ? { warning: errors.join(" · ") } : {}),
    });
  } catch (err) {
    console.error("GET /api/queue failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Queue fetch failed" }, { status: 500 });
  }
}
