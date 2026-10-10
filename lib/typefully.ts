/**
 * Typefully API v2 client (server-side only).
 * Docs: https://typefully.com/docs/api
 *  - Auth: Authorization: Bearer <key>
 *  - Drafts: POST /v2/social-sets/{social_set_id}/drafts
 *  - Publish scheduling via `publish_at` (ISO 8601 with timezone)
 */

import { requiredEnv } from "./config";
import type { PublishEngine } from "./publish-engine";

const BASE = "https://api.typefully.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function tfFetch(path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredEnv("TYPEFULLY_API_KEY")}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Typefully ${res.status} on ${path}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

export interface SocialSet {
  id: string;
  name: string;
}

/** First page of social sets on the account (id + name) — diagnostics/verify use only. */
export async function listSocialSets(): Promise<SocialSet[]> {
  const resp = await tfFetch(`/v2/social-sets`);
  const sets = resp.results ?? resp;
  if (!Array.isArray(sets)) return [];
  return sets.map((s: Json) => ({ id: String(s.id), name: String(s.name ?? "") }));
}

let cachedSocialSetId: string | null = null;

export async function getSocialSetId(): Promise<string> {
  const pinned = process.env.TYPEFULLY_SOCIAL_SET_ID;
  if (pinned) return pinned;
  if (cachedSocialSetId) return cachedSocialSetId;
  const resp = await tfFetch(`/v2/social-sets`);
  const sets = resp.results ?? resp;
  if (!Array.isArray(sets) || sets.length === 0) throw new Error("No Typefully social sets on this account");
  cachedSocialSetId = String(sets[0].id);
  return cachedSocialSetId;
}

/** Explicit thread break marker in draft bodies (PRD §8.1). */
export const THREAD_BREAK = /\n\n---\n\n/;

export interface CreateDraftResult {
  id: string;
  url: string | null;
}

/**
 * Create a scheduled Typefully draft.
 * - X: threadify off — a single post unless the body contains explicit
 *   `\n\n---\n\n` breaks, which map to thread posts.
 * - LinkedIn: always a single post.
 * - Substack (Notes): always a single post. Notes have no thread concept,
 *   so the thread-break marker is deliberately not honoured here.
 */
export async function createScheduledDraft(opts: {
  platform: "x" | "linkedin" | "substack";
  body: string;
  publishAtIso: string;
}): Promise<CreateDraftResult> {
  const socialSetId = await getSocialSetId();
  const posts =
    opts.platform === "x"
      ? opts.body.split(THREAD_BREAK).map((text) => ({ text: text.trim() }))
      : [{ text: opts.body.trim() }];
  const payload = {
    platforms: {
      [opts.platform]: {
        enabled: true,
        posts,
      },
    },
    publish_at: opts.publishAtIso,
  };
  const draft = await tfFetch(`/v2/social-sets/${socialSetId}/drafts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { id: String(draft.id), url: draft.share_url ?? draft.url ?? null };
}

export interface DraftState {
  status: string; // draft | scheduled | published | publishing | error | planned
  publishedUrl: string | null;
}

/**
 * Normalizes both the legacy `status` field and the current API's
 * `publish_state` field (which reaches "finished" once publishing
 * completes) into the single `status` shape lib/publisher.ts expects.
 */
export async function getDraftState(draftId: string): Promise<DraftState> {
  const socialSetId = await getSocialSetId();
  const d = await tfFetch(`/v2/social-sets/${socialSetId}/drafts/${draftId}`);
  const legacyStatus = String(d.status ?? "").toLowerCase();
  const publishState = String(d.publish_state ?? "").toLowerCase();
  const status = legacyStatus === "published" || publishState === "finished" ? "published" : legacyStatus || publishState;
  return {
    status,
    publishedUrl: d.x_published_url ?? d.linkedin_published_url ?? d.substack_published_url ?? null,
  };
}

export async function deleteDraft(draftId: string): Promise<void> {
  const socialSetId = await getSocialSetId();
  await tfFetch(`/v2/social-sets/${socialSetId}/drafts/${draftId}`, { method: "DELETE" });
}

export function typefullyDraftUrl(draftId: string): string {
  return `https://typefully.com/?d=${draftId}`;
}

/**
 * Typefully as a PublishEngine (lib/publish-engine.ts). A thin pass-through —
 * the functions above are unchanged and still exported for the verify script.
 * Ids are Typefully draft ids, stored un-prefixed in Notion.
 */
export const typefullyEngine: PublishEngine = {
  key: "typefully",
  createScheduledPost: (opts) => createScheduledDraft(opts),
  getPostState: (id) => getDraftState(id),
  deletePost: (id) => deleteDraft(id),
};
