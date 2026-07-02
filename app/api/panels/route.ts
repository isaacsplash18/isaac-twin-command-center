import { NextResponse } from "next/server";
import { queryDataSource, queryEvents, readSelectProp, readTitle, readDateProp, plainText } from "@/lib/notion";
import { requiredEnv } from "@/lib/config";

export const dynamic = "force-dynamic";

interface LinkItem {
  id: string;
  title: string;
  url: string;
  meta?: string;
}

/**
 * GET /api/panels — Positions Library health, Inbox/Wiki inputs (read-only),
 * and recent publish failures for the alert banner.
 */
export async function GET() {
  try {
    const [positions, inbox, wiki, events] = await Promise.all([
      queryDataSource(requiredEnv("DS_POSITIONS"), { page_size: 100 }, 2).catch(() => []),
      queryDataSource(
        requiredEnv("DS_INBOX"),
        {
          // "Untriaged" = Status New (verified against the live Inbox schema)
          filter: { property: "Status", select: { equals: "New" } },
          sorts: [{ timestamp: "created_time", direction: "descending" }],
          page_size: 12,
        },
        1
      ).catch(() => []),
      queryDataSource(
        requiredEnv("DS_WIKI"),
        { sorts: [{ timestamp: "last_edited_time", direction: "descending" }], page_size: 8 },
        1
      ).catch(() => []),
      queryEvents(new Date(Date.now() - 48 * 3600_000).toISOString()).catch(() => []),
    ]);

    const confidenceCounts: Record<string, number> = { Confirmed: 0, Predicted: 0, Contested: 0 };
    const needsValidation: LinkItem[] = [];
    for (const p of positions) {
      const confidence = readSelectProp(p, "Confidence");
      if (confidence && confidence in confidenceCounts) confidenceCounts[confidence]++;
      if (readSelectProp(p, "Status") === "Needs validation" && needsValidation.length < 12) {
        needsValidation.push({ id: p.id, title: readTitle(p), url: p.url });
      }
    }

    const failures = events
      .filter((e) => readSelectProp(e, "Event") === "Publish-failed")
      .map((e) => ({
        id: e.id,
        platform: readSelectProp(e, "Platform"),
        at: readDateProp(e, "Timestamp"),
        notes: plainText(e.properties?.Notes?.rich_text),
        itemUrl: e.properties?.Item?.url ?? null,
      }));

    return NextResponse.json({
      positions: {
        total: positions.length,
        confidenceCounts,
        activeCount: positions.filter((p) => readSelectProp(p, "Status") === "Active").length,
        needsValidation,
      },
      inbox: inbox.map((p) => ({ id: p.id, title: readTitle(p), url: p.url, meta: p.created_time })),
      wiki: wiki.map((p) => ({ id: p.id, title: readTitle(p), url: p.url, meta: p.last_edited_time })),
      publishFailures: failures,
    });
  } catch (err) {
    console.error("GET /api/panels failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Panels fetch failed" }, { status: 500 });
  }
}
