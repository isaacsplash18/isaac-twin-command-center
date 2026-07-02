/**
 * Shared shaping of Notion content pages into the app's ContentItem shape,
 * plus status-filtered queries used by the queue API and the crons.
 */

import { PLATFORMS, PlatformConfig, PlatformKey, dataSourceId } from "./config";
import {
  NotionPage,
  buildStatusUpdate,
  findProperty,
  getDataSourceSchema,
  queryDataSource,
  readBody,
  readCheckboxProp,
  readDateProp,
  readRichTextProp,
  readSelectProp,
  readStatus,
  readTitle,
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
