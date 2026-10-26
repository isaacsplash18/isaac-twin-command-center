import { NextResponse } from "next/server";
import { NotionPage, queryDataSource, readRichTextProp, readSelectProp, readTitle, readDateProp } from "@/lib/notion";
import { requiredEnv } from "@/lib/config";

export const dynamic = "force-dynamic";

const TEXT_LIMIT = 500;

function clip(text: string, limit = TEXT_LIMIT): string {
  const t = text.trim();
  return t.length > limit ? `${t.slice(0, limit - 1).trimEnd()}…` : t;
}

function readMultiSelect(page: NotionPage, name: string): string[] {
  const prop = page.properties?.[name];
  if (prop?.type !== "multi_select") return [];
  return (prop.multi_select ?? []).map((o: { name?: string }) => o.name ?? "").filter(Boolean);
}

function readNumber(page: NotionPage, name: string): number | null {
  const prop = page.properties?.[name];
  return prop?.type === "number" && typeof prop.number === "number" ? prop.number : null;
}

function normaliseId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/** Page ids referenced by a Linked Position value — a link/mention in rich_text, or a relation. */
function linkedPageIds(page: NotionPage, name: string): string[] {
  const prop = page.properties?.[name];
  if (!prop) return [];
  if (prop.type === "relation") return (prop.relation ?? []).map((r: { id: string }) => normaliseId(r.id));
  if (prop.type !== "rich_text") return [];
  const ids = new Set<string>();
  for (const rt of prop.rich_text ?? []) {
    if (rt.type === "mention" && rt.mention?.page?.id) ids.add(normaliseId(String(rt.mention.page.id)));
    const sources = [rt.href, rt.text?.link?.url, rt.plain_text].filter((s): s is string => typeof s === "string");
    for (const s of sources) {
      const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) ?? s.match(/[0-9a-f]{32}/i);
      if (m) ids.add(normaliseId(m[0]));
    }
  }
  return [...ids];
}

/**
 * GET /api/map — Personal Constitution positions, Source Corpus nodes and
 * live Inbox captures as a graph, clustered around domain hubs.
 */
export async function GET() {
  try {
    const [positions, wiki, inbox] = await Promise.all([
      queryDataSource(requiredEnv("DS_POSITIONS"), { page_size: 100 }, 5).catch(() => []),
      queryDataSource(requiredEnv("DS_WIKI"), { page_size: 100 }, 5).catch(() => []),
      queryDataSource(requiredEnv("DS_INBOX"), { page_size: 100 }, 3).catch(() => []),
    ]);

    const nodes: Record<string, unknown>[] = [];
    const links: { source: string; target: string; kind: "domain" | "evidence" }[] = [];
    const domainMembers = new Map<string, number>();
    const linkToDomains = (id: string, domains: string[]) => {
      for (const d of domains) {
        domainMembers.set(d, (domainMembers.get(d) ?? 0) + 1);
        links.push({ source: id, target: `domain:${d}`, kind: "domain" });
      }
    };

    const positionIds = new Map<string, string>();
    for (const p of positions) {
      const domains = readMultiSelect(p, "Domain");
      positionIds.set(normaliseId(p.id), p.id);
      nodes.push({
        id: p.id,
        kind: "position",
        label: readTitle(p) || "Untitled position",
        confidence: readSelectProp(p, "Confidence"),
        status: readSelectProp(p, "Status"),
        domains,
        nuance: clip(readRichTextProp(p, "Nuance")),
        basis: clip(readRichTextProp(p, "Basis")),
        question: clip(readRichTextProp(p, "Question")),
        lastValidated: readDateProp(p, "Last validated"),
        url: p.url,
      });
      linkToDomains(p.id, domains);
    }

    for (const w of wiki) {
      const domains = readMultiSelect(w, "Domain");
      nodes.push({
        id: w.id,
        kind: "corpus",
        label: readTitle(w) || "Untitled node",
        nodeType: readSelectProp(w, "Node type"),
        maturity: readSelectProp(w, "Maturity"),
        domains,
        summary: clip(readRichTextProp(w, "Summary")),
        url: w.url,
        recurrence: readNumber(w, "Recurrence"),
      });
      linkToDomains(w.id, domains);
      for (const linked of linkedPageIds(w, "Linked Position")) {
        const target = positionIds.get(linked);
        if (target) links.push({ source: w.id, target, kind: "evidence" });
      }
    }

    let captureCount = 0;
    for (const c of inbox) {
      if (readSelectProp(c, "Status") === "Discarded") continue;
      const domains = readMultiSelect(c, "Domain");
      captureCount++;
      nodes.push({
        id: c.id,
        kind: "capture",
        label: readTitle(c) || "Untitled capture",
        type: readSelectProp(c, "Type"),
        status: readSelectProp(c, "Status"),
        domains,
        note: clip(readRichTextProp(c, "Triage note")),
        url: c.url,
        sourceUrl: /^https?:\/\//i.test(c.properties?.["Source URL"]?.url ?? "") ? c.properties["Source URL"].url : null,
      });
      linkToDomains(c.id, domains);
    }

    const domainNodes = [...domainMembers.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, members]) => ({ id: `domain:${name}`, kind: "domain", label: name, members }));

    return NextResponse.json({
      nodes: [...domainNodes, ...nodes],
      links,
      counts: {
        domains: domainNodes.length,
        positions: positions.length,
        corpus: wiki.length,
        captures: captureCount,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /api/map failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Map fetch failed" }, { status: 500 });
  }
}
