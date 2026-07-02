/**
 * Minimal Notion client over raw fetch, pinned to the data-sources API era
 * (Notion-Version 2025-09-03 by default). Server-side only.
 *
 * Notion is the single source of truth; this module never caches page data.
 * Other agents write to the same DBs — always re-read before write and
 * tolerate unknown property shapes.
 */

import { requiredEnv } from "./config";

const NOTION_BASE = "https://api.notion.com/v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotionPage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export async function notionFetch(path: string, init?: RequestInit & { retries?: number }): Promise<Json> {
  const retries = init?.retries ?? 3;
  const url = `${NOTION_BASE}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${requiredEnv("NOTION_TOKEN")}`,
        "Notion-Version": process.env.NOTION_VERSION || "2025-09-03",
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`Notion ${res.status} on ${path} after ${retries} retries`);
      const retryAfter = Number(res.headers.get("retry-after")) || 1 + attempt;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion ${res.status} on ${path}: ${body.slice(0, 500)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
}

// ---------------------------------------------------------------------------
// Data source queries
// ---------------------------------------------------------------------------

export async function queryDataSource(
  dataSourceId: string,
  body: { filter?: Json; sorts?: Json[]; page_size?: number } = {},
  maxPages = 5
): Promise<NotionPage[]> {
  const results: NotionPage[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const resp = await notionFetch(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ ...body, start_cursor: cursor, page_size: body.page_size ?? 100 }),
    });
    results.push(...resp.results);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return results;
}

const schemaCache = new Map<string, Json>();

export async function getDataSourceSchema(dataSourceId: string): Promise<Json> {
  const cached = schemaCache.get(dataSourceId);
  if (cached) return cached;
  const ds = await notionFetch(`/data_sources/${dataSourceId}`);
  schemaCache.set(dataSourceId, ds);
  return ds;
}

/** Find a property name in a schema case-insensitively; returns [name, def] or undefined. */
export function findProperty(schema: Json, name: string): [string, Json] | undefined {
  const props = schema.properties ?? {};
  const exact = props[name];
  if (exact) return [name, exact];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(props)) {
    if (k.toLowerCase() === lower) return [k, v as Json];
  }
  return undefined;
}

export function titlePropertyName(schema: Json): string {
  for (const [k, v] of Object.entries(schema.properties ?? {})) {
    if ((v as Json).type === "title") return k;
  }
  return "Name";
}

// ---------------------------------------------------------------------------
// Property value readers (page objects)
// ---------------------------------------------------------------------------

export function plainText(richText: Json[] | undefined): string {
  return (richText ?? []).map((t) => t.plain_text ?? "").join("");
}

export function readTitle(page: NotionPage): string {
  for (const v of Object.values(page.properties ?? {})) {
    const prop = v as Json;
    if (prop.type === "title") return plainText(prop.title);
  }
  return "";
}

export function readStatus(page: NotionPage): string | null {
  for (const [k, v] of Object.entries(page.properties ?? {})) {
    if (k.toLowerCase() !== "status") continue;
    const prop = v as Json;
    if (prop.type === "status") return prop.status?.name ?? null;
    if (prop.type === "select") return prop.select?.name ?? null;
  }
  return null;
}

export function readRichTextProp(page: NotionPage, name: string): string {
  const prop = page.properties?.[name];
  if (prop?.type === "rich_text") return plainText(prop.rich_text);
  return "";
}

export function readDateProp(page: NotionPage, name: string): string | null {
  const prop = page.properties?.[name];
  return prop?.type === "date" ? (prop.date?.start ?? null) : null;
}

export function readCheckboxProp(page: NotionPage, name: string): boolean {
  const prop = page.properties?.[name];
  return prop?.type === "checkbox" ? !!prop.checkbox : false;
}

export function readSelectProp(page: NotionPage, name: string): string | null {
  const prop = page.properties?.[name];
  if (!prop) return null;
  if (prop.type === "select") return prop.select?.name ?? null;
  if (prop.type === "status") return prop.status?.name ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Property writers
// ---------------------------------------------------------------------------

/**
 * Build the correct Status property update for a data source, handling both
 * `select` and `status` property types. Returns { propName, value }.
 */
export async function buildStatusUpdate(dataSourceId: string, statusName: string): Promise<Record<string, Json>> {
  const schema = await getDataSourceSchema(dataSourceId);
  const found = findProperty(schema, "Status");
  if (!found) throw new Error(`Data source ${dataSourceId} has no Status property`);
  const [propName, def] = found;
  if (def.type === "status") return { [propName]: { status: { name: statusName } } };
  return { [propName]: { select: { name: statusName } } };
}

export async function updatePage(pageId: string, properties: Record<string, Json>): Promise<NotionPage> {
  return notionFetch(`/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
}

export async function getPage(pageId: string): Promise<NotionPage> {
  return notionFetch(`/pages/${pageId}`);
}

export function richTextValue(text: string): Json {
  // Notion caps a rich_text item at 2000 chars; chunk to stay additive-safe.
  const chunks: Json[] = [];
  for (let i = 0; i < text.length; i += 2000) {
    chunks.push({ type: "text", text: { content: text.slice(i, i + 2000) } });
  }
  return { rich_text: chunks.length ? chunks : [] };
}

// ---------------------------------------------------------------------------
// Page body (blocks) round-trip — plain paragraphs only, never clobber other
// block types (PRD §13).
// ---------------------------------------------------------------------------

export async function listBlocks(pageId: string): Promise<Json[]> {
  const blocks: Json[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : "?page_size=100";
    const resp = await notionFetch(`/blocks/${pageId}/children${qs}`);
    blocks.push(...resp.results);
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return blocks;
}

/** Read the draft body: all paragraph blocks joined with blank lines. */
export async function readBody(pageId: string): Promise<string> {
  const blocks = await listBlocks(pageId);
  const paras = blocks
    .filter((b) => b.type === "paragraph")
    .map((b) => plainText(b.paragraph?.rich_text));
  return paras.join("\n\n").trim();
}

/**
 * Replace the paragraph blocks of a page with new text (split on blank
 * lines). Non-paragraph blocks are left untouched.
 */
export async function writeBody(pageId: string, text: string): Promise<void> {
  const blocks = await listBlocks(pageId);
  const paragraphIds = blocks.filter((b) => b.type === "paragraph").map((b) => b.id);
  const newParagraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: p.slice(0, 2000) } }] },
    }));
  // Append first, then delete old paragraphs, so a mid-operation failure
  // never leaves the page empty.
  if (newParagraphs.length) {
    await notionFetch(`/blocks/${pageId}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: newParagraphs }),
    });
  }
  for (const id of paragraphIds) {
    await notionFetch(`/blocks/${id}`, { method: "DELETE" });
  }
}

// ---------------------------------------------------------------------------
// Pipeline Events
// ---------------------------------------------------------------------------

export type PipelineEvent =
  | "Approved"
  | "Approved-with-edits"
  | "Rejected"
  | "Queued"
  | "Posted"
  | "Publish-failed";

export async function logEvent(opts: {
  event: PipelineEvent;
  platform: string;
  itemUrl: string;
  diff?: string;
  notes?: string;
}): Promise<void> {
  const dsEvents = process.env.DS_EVENTS;
  if (!dsEvents) {
    console.warn("DS_EVENTS not set — skipping pipeline event log:", opts.event, opts.itemUrl);
    return;
  }
  const schema = await getDataSourceSchema(dsEvents);
  const titleProp = titlePropertyName(schema);
  await notionFetch(`/pages`, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dsEvents },
      properties: {
        [titleProp]: { title: [{ type: "text", text: { content: `${opts.event} — ${opts.platform}` } }] },
        Event: { select: { name: opts.event } },
        Platform: { select: { name: opts.platform } },
        Item: { url: opts.itemUrl },
        Timestamp: { date: { start: new Date().toISOString() } },
        ...(opts.diff ? { Diff: richTextValue(opts.diff.slice(0, 8000)) } : {}),
        ...(opts.notes ? { Notes: richTextValue(opts.notes.slice(0, 2000)) } : {}),
      },
    }),
  });
}

export async function queryEvents(sinceIso: string): Promise<NotionPage[]> {
  const dsEvents = process.env.DS_EVENTS;
  if (!dsEvents) return [];
  return queryDataSource(dsEvents, {
    filter: { property: "Timestamp", date: { on_or_after: sinceIso } },
    sorts: [{ property: "Timestamp", direction: "descending" }],
  });
}
