/**
 * Shared shaping of Notion content pages into the app's ContentItem shape,
 * plus status-filtered queries used by the queue API and the crons.
 */

import { PLATFORMS, PlatformConfig, PlatformKey, dataSourceId, platform } from "./config";
import {
  NotionPage,
  buildStatusUpdate,
  findProperty,
  getDataSourceSchema,
  notionFetch,
  queryDataSource,
  readBody,
  readCheckboxProp,
  readDateProp,
  readRichTextProp,
  readSelectProp,
  readStatus,
  readTitle,
  richTextValue,
  titlePropertyName,
} from "./notion";

export interface ContentItem {
  id: string;
  platform: PlatformKey;
  platformLabel: string;
  autoPublish: boolean;
  title: string;
  body: string;
  /** IG Carousel slide texts, shown read-only. */
  slides: string | null;
  status: string | null;
  notionUrl: string;
  createdTime: string;
  lastEditedTime: string;
  scheduledAt: string | null;
  approvedAt: string | null;
  editedBeforeApproval: boolean;
  typefullyId: string | null;
  inCanva: boolean;
}

export async function statusFilter(dsId: string, statusName: string) {
  const schema = await getDataSourceSchema(dsId);
  const found = findProperty(schema, "Status");
  if (!found) throw new Error(`Data source ${dsId} has no Status property`);
  const [propName, def] = found;
  return def.type === "status"
    ? { property: propName, status: { equals: statusName } }
    : { property: propName, select: { equals: statusName } };
}

/** Resolve the draft body for a page per its platform's storage convention. */
export async function readItemBody(page: NotionPage, p: PlatformConfig): Promise<string> {
  if (p.bodyProp) {
    const fromProp = readRichTextProp(page, p.bodyProp);
    if (fromProp) return fromProp;
  }
  if (p.bodyInPageContent || p.bodyProp) {
    const fromContent = await readBody(page.id);
    if (fromContent) return fromContent;
  }
  return readTitle(page);
}

export async function toContentItem(page: NotionPage, p: PlatformConfig, withBody: boolean): Promise<ContentItem> {
  const body = withBody ? await readItemBody(page, p) : p.bodyProp ? readRichTextProp(page, p.bodyProp) : "";
  const title = readTitle(page);
  return {
    id: page.id,
    platform: p.key,
    platformLabel: p.label,
    autoPublish: p.autoPublish,
    title,
    body: body || title, // fall back to the title when the page has no content
    slides: p.slidesProp ? readRichTextProp(page, p.slidesProp) || null : null,
    status: readStatus(page),
    notionUrl: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    scheduledAt: readDateProp(page, "Scheduled At"),
    approvedAt: readDateProp(page, "Approved At"),
    editedBeforeApproval: readCheckboxProp(page, "Edited Before Approval"),
    typefullyId: readRichTextProp(page, "Typefully ID") || null,
    inCanva: readSelectProp(page, "Status") === "In Canva",
  };
}

export async function itemsWithStatus(
  p: PlatformConfig,
  statusName: string,
  opts: { withBody?: boolean; limit?: number } = {}
): Promise<ContentItem[]> {
  const dsId = dataSourceId(p);
  const filter = await statusFilter(dsId, statusName);
  const pages = await queryDataSource(dsId, {
    filter,
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: Math.min(opts.limit ?? 100, 100),
  });
  const sliced = opts.limit ? pages.slice(0, opts.limit) : pages;
  return Promise.all(sliced.map((page) => toContentItem(page, p, opts.withBody ?? false)));
}

/** Locate the platform config for a page id by checking which DS the page belongs to. */
export function platformFromPage(page: NotionPage): PlatformConfig | null {
  const parentDs: string | undefined = page.parent?.data_source_id ?? page.parent?.database_id;
  if (!parentDs) return null;
  const normalized = parentDs.replace(/-/g, "");
  for (const p of PLATFORMS) {
    const envId = process.env[p.dsEnv];
    if (envId && envId.replace(/-/g, "") === normalized) return p;
  }
  return null;
}

export { buildStatusUpdate };

// ---------------------------------------------------------------------------
// Draft creation bridge (Phase 7 — docs/hermes-calibration-plan.md §4.4)
//
// This is the inverse of readItemBody: given a platform + title + body (and
// optional Hermes provenance fields), create a new Draft-status page in the
// right content DB. Never publishes, never sets any status other than
// "Draft" — the page lands in the existing approval queue with zero UI
// changes. The four provenance properties (Created By / Source Workflow /
// Humanizer / Source Position IDs) are additive Notion schema (see
// scripts/migrate.ts) and are written defensively: if a content DB hasn't
// been migrated yet, the create is retried without them and a warning is
// returned rather than failing the whole request.
// ---------------------------------------------------------------------------

/** Thrown for bad input; carries an HTTP status the route can use directly (400 by default). */
export class DraftInputError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

const MAX_DRAFT_BODY_LENGTH = 20_000;

/** Accepts either the app's hyphenated platform keys or the export schema's snake_case aliases. */
export function normalizePlatformKey(input: string): PlatformKey | null {
  const key = (input ?? "").trim().toLowerCase().replace(/_/g, "-");
  const found = PLATFORMS.find((p) => p.key === key);
  return found ? found.key : null;
}

export interface CreateDraftInput {
  platform: string;
  title: string;
  body: string;
  sourcePositionIds?: string[];
  sourceWorkflow?: string;
  humanizerStatus?: "passed" | "failed" | "unknown";
  createdBy?: "hermes" | "agent";
}

export interface CreateDraftResult {
  id: string;
  url: string;
  platform: PlatformKey;
  status: "Draft";
  warnings: string[];
}

/** Split on blank lines into Notion paragraph blocks, mirroring writeBody's chunking rules (lib/notion.ts). */
function paragraphBlocksForCreate(text: string) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    // Chunk each paragraph into multiple ≤2000-char rich_text items within one
    // paragraph block (richTextValue does the chunking) — a single paragraph
    // longer than 2000 chars must not be truncated.
    .map((p) => ({
      object: "block",
      type: "paragraph",
      paragraph: richTextValue(p),
    }));
}

/** Matches the Notion "unknown property" validation error, regardless of which of the 4 additive props triggered it. */
const SCHEMA_MISMATCH_PATTERN = /is not a property that exists|property that does not exist|is not a valid property/i;

export async function createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
  const platformKey = normalizePlatformKey(input.platform);
  if (!platformKey) {
    throw new DraftInputError(
      `Unknown platform "${input.platform}" — expected one of: x, linkedin, ig-story (or ig_story), ig-carousel (or ig_carousel)`
    );
  }
  const p = platform(platformKey);

  const title = (input.title ?? "").trim();
  if (!title) throw new DraftInputError("title is required");

  const body = input.body ?? "";
  if (!body.trim()) throw new DraftInputError("body is required");
  if (body.length > MAX_DRAFT_BODY_LENGTH) {
    throw new DraftInputError(`body exceeds ${MAX_DRAFT_BODY_LENGTH} characters (got ${body.length})`);
  }

  const createdBy = input.createdBy ?? "hermes";
  const humanizerStatus = input.humanizerStatus ?? "unknown";
  const dsId = dataSourceId(p);
  const schema = await getDataSourceSchema(dsId);
  const titleProp = titlePropertyName(schema);

  const baseProperties: Record<string, unknown> = {
    [titleProp]: { title: [{ type: "text", text: { content: title.slice(0, 2000) } }] },
    ...(await buildStatusUpdate(dsId, "Draft")),
  };
  if (p.bodyProp) {
    // IG Story ("IG Story Copy") / IG Carousel ("Caption") — body lives in a rich-text prop.
    baseProperties[p.bodyProp] = richTextValue(body);
  }

  const provenanceProperties: Record<string, unknown> = {
    "Created By": { select: { name: createdBy } },
    Humanizer: { select: { name: humanizerStatus } },
  };
  if (input.sourceWorkflow?.trim()) {
    provenanceProperties["Source Workflow"] = richTextValue(input.sourceWorkflow.trim());
  }
  if (input.sourcePositionIds?.length) {
    provenanceProperties["Source Position IDs"] = richTextValue(input.sourcePositionIds.join(","));
  }

  // X/LinkedIn: body goes to page content (blocks), passed as `children` on create.
  const children = p.bodyInPageContent && !p.bodyProp ? paragraphBlocksForCreate(body) : undefined;

  const buildPayload = (properties: Record<string, unknown>) => ({
    parent: { type: "data_source_id", data_source_id: dsId },
    properties,
    ...(children && children.length ? { children } : {}),
  });

  const warnings: string[] = [];
  let page: NotionPage;
  try {
    page = await notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify(buildPayload({ ...baseProperties, ...provenanceProperties })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!SCHEMA_MISMATCH_PATTERN.test(message)) throw err;
    warnings.push(
      "Created By / Source Workflow / Humanizer / Source Position IDs not yet migrated (run npm run migrate) — draft created without them"
    );
    page = await notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify(buildPayload(baseProperties)),
    });
  }

  return { id: page.id, url: page.url, platform: platformKey, status: "Draft", warnings };
}
