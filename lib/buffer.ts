/**
 * Buffer API client — second publishing engine (server-side only).
 *
 * This targets Buffer's NEW GraphQL API (relaunched 2026), NOT the legacy REST
 * api.bufferapp.com. Docs:
 *  - Overview / guides:   https://developers.buffer.com/
 *  - Auth + endpoint:     https://developers.buffer.com/guides/authentication.html
 *  - Scheduling:          https://developers.buffer.com/guides/posts-and-scheduling.html
 *  - Reference:           https://developers.buffer.com/reference.html
 *                         (per-type pages: https://developers.buffer.com/types/<Type>.md)
 *  - Examples used below: examples/create-scheduled-post.html,
 *                         examples/create-threaded-post.html,
 *                         examples/get-channels.html, examples/get-organizations.html
 *
 * Transport (authentication.html):
 *  - Endpoint: POST https://api.buffer.com   (JSON body { query, variables })
 *  - Auth:     Authorization: Bearer <personal API key from
 *              https://publish.buffer.com/settings/api>
 *  - HTTP status is 200 even for errors (error-handling.html): typed mutation
 *    failures arrive in `data` (MutationError { message }); non-recoverable
 *    ones in the top-level `errors` array with extensions.code
 *    (UNAUTHORIZED | FORBIDDEN | NOT_FOUND | UNEXPECTED | RATE_LIMIT_EXCEEDED).
 *
 * Operations used (names verified against the docs above):
 *  - createPost(input: CreatePostInput!) → PostActionPayload
 *      CreatePostInput: channelId, text, dueAt (DateTime), mode: ShareMode!
 *      (we send `customScheduled`), schedulingType: SchedulingType! (we send
 *      `automatic` — Buffer's workers publish; `notification` would only
 *      remind someone). X threads: metadata.twitter.thread: [{ text }]
 *      (types/TwitterPostMetadataInput, ThreadedPostInput).
 *  - post(input: { id }) → Post { id status sentAt dueAt externalLink error }
 *      PostStatus enum: draft | error | needs_approval | scheduled | sending | sent
 *      (types/PostStatus.md). `sent` ⇒ our "published"; `externalLink` is the
 *      URL on the destination service.
 *  - deletePost(input: { id }) → DeletePostPayload = DeletePostSuccess { id }
 *      | VoidMutationError (types/DeletePostPayload.md).
 *  - account { organizations { id } } and channels(input: { organizationId })
 *      → [Channel { id name displayName service isDisconnected isLocked
 *      isQueuePaused }] — diagnostics only (scripts/verify-buffer.ts --live).
 *      Service enum includes `twitter`, `linkedin`, `substack` (types/Service.md).
 *
 * Ids are stored in Notion's "Typefully ID" property with a `buffer:` prefix
 * (see lib/publish-engine.ts). Everything in this file takes/returns RAW Buffer
 * ids; stripBufferPrefix() is only a defensive no-op for already-raw ids.
 *
 * X THREADS: supported. Bodies containing the explicit `\n\n---\n\n` marker
 * (same marker as Typefully, PRD §8.1) are sent as metadata.twitter.thread —
 * "every post in the thread - including the first one - must be provided as an
 * item in the thread array" and top-level `text` must equal the first item
 * (create-threaded-post.html). LinkedIn / Substack bodies are always a single
 * post, marker not honoured — same as lib/typefully.ts. Guards (ActionError, so
 * the item stays Approved with a Publish-failed event instead of posting
 * something mangled): empty thread segment, missing channel id.
 */

import { BUFFER_CHANNEL_ENVS, BUFFER_ID_PREFIX, PlatformKey } from "./config";
import { ActionError } from "./actions";
import { THREAD_BREAK } from "./typefully";
import type { PublishEngine, SchedulablePlatformKey } from "./publish-engine";

const ENDPOINT = "https://api.buffer.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function accessToken(): string {
  const t = process.env.BUFFER_ACCESS_TOKEN;
  if (!t) throw new Error("Missing environment variable BUFFER_ACCESS_TOKEN");
  return t;
}

async function bufferGql(query: string, variables?: Record<string, unknown>): Promise<Json> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Buffer ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const e = json.errors[0];
    const code = e?.extensions?.code ? ` [${e.extensions.code}]` : "";
    const err = new Error(`Buffer GraphQL error${code}: ${String(e?.message ?? "unknown").slice(0, 500)}`) as Error & {
      code?: string;
    };
    err.code = e?.extensions?.code;
    throw err;
  }
  return json.data;
}

/** Defensive: engines receive RAW ids from parseStoredId(); strip a stray prefix rather than 404 against Buffer. */
function stripBufferPrefix(id: string): string {
  return id.startsWith(BUFFER_ID_PREFIX) ? id.slice(BUFFER_ID_PREFIX.length) : id;
}

export function bufferChannelId(platform: PlatformKey): string {
  const envName = BUFFER_CHANNEL_ENVS[platform];
  const id = envName ? process.env[envName] : undefined;
  if (!envName || !id) {
    throw new Error(`No Buffer channel configured for platform "${platform}" (set ${envName ?? "a BUFFER_CHANNEL_* variable"})`);
  }
  return id;
}

/**
 * Pure: split an X body into thread post texts, or null when it is a single
 * post. Exported for scripts/verify-buffer.ts. Throws ActionError on an empty
 * segment (e.g. a trailing `---`) rather than sending Buffer an empty post.
 */
export function xThreadTexts(body: string): string[] | null {
  if (!THREAD_BREAK.test(body)) return null;
  const texts = body.split(THREAD_BREAK).map((t) => t.trim());
  if (texts.some((t) => !t)) {
    throw new ActionError("X thread body has an empty post between thread breaks — fix the draft before publishing via Buffer", 422);
  }
  return texts;
}

/** Pure: the `createPost` input for a platform/body/time. Exported for verify. */
export function buildCreatePostInput(opts: {
  platform: SchedulablePlatformKey;
  body: string;
  publishAtIso: string;
  channelId: string;
}): Record<string, unknown> {
  const dueAt = new Date(opts.publishAtIso).toISOString(); // Buffer wants ISO 8601 UTC
  const base = {
    channelId: opts.channelId,
    schedulingType: "automatic",
    mode: "customScheduled",
    dueAt,
  };
  if (opts.platform === "x") {
    const thread = xThreadTexts(opts.body);
    if (thread) {
      return { ...base, text: thread[0], metadata: { twitter: { thread: thread.map((text) => ({ text })) } } };
    }
  }
  return { ...base, text: opts.body.trim() };
}

const CREATE_POST = /* GraphQL */ `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess {
        post {
          id
          status
          externalLink
        }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

export async function createScheduledPost(opts: {
  platform: SchedulablePlatformKey;
  body: string;
  publishAtIso: string;
}): Promise<{ id: string; url: string | null }> {
  if (!opts.body.trim()) throw new Error("Empty draft body");
  const input = buildCreatePostInput({ ...opts, channelId: bufferChannelId(opts.platform) });
  const data = await bufferGql(CREATE_POST, { input });
  const r = data?.createPost;
  if (!r?.post?.id) {
    throw new Error(`Buffer createPost failed (${r?.__typename ?? "no result"}): ${String(r?.message ?? "no message").slice(0, 500)}`);
  }
  // Scheduled posts have no permalink yet; Buffer's dashboard has no per-post deep link we rely on.
  return { id: String(r.post.id), url: null };
}

const GET_POST = /* GraphQL */ `
  query GetPost($input: PostInput!) {
    post(input: $input) {
      id
      status
      sentAt
      externalLink
      error {
        message
      }
    }
  }
`;

/** Pure: Buffer PostStatus → the status vocabulary lib/publisher.ts expects ("published" | "error" | other). */
export function mapBufferStatus(status: string | null | undefined): string {
  const s = String(status ?? "").toLowerCase();
  return s === "sent" ? "published" : s;
}

export async function getPostState(id: string): Promise<{ status: string; publishedUrl: string | null }> {
  const data = await bufferGql(GET_POST, { input: { id: stripBufferPrefix(id) } });
  const p = data?.post;
  if (!p) throw new Error(`Buffer post ${id} not found`);
  return { status: mapBufferStatus(p.status), publishedUrl: p.externalLink ?? null };
}

const DELETE_POST = /* GraphQL */ `
  mutation DeletePost($input: DeletePostInput!) {
    deletePost(input: $input) {
      __typename
      ... on DeletePostSuccess {
        id
      }
      ... on VoidMutationError {
        message
      }
    }
  }
`;

/**
 * Idempotent: a post that is already gone (NOT_FOUND) counts as deleted — this
 * mirrors unqueueItem's old "404 = already gone" tolerance for Typefully.
 */
export async function deletePost(id: string): Promise<void> {
  let data: Json;
  try {
    data = await bufferGql(DELETE_POST, { input: { id: stripBufferPrefix(id) } });
  } catch (err) {
    if ((err as { code?: string }).code === "NOT_FOUND") return;
    throw err;
  }
  const r = data?.deletePost;
  if (r?.__typename === "DeletePostSuccess") return;
  // Verified against the live API (10 Oct 2026): deleting an already-deleted
  // post returns a typed VoidMutationError { message: "Document not found" }
  // in data — NOT a top-level NOT_FOUND error. Treat it as already-gone so
  // unqueue keeps its idempotent "404 = fine" tolerance.
  if (r?.__typename === "VoidMutationError" && /not found/i.test(r?.message ?? "")) return;
  throw new Error(
    `Buffer deletePost failed (${r?.__typename ?? "no result"}${r?.message ? `: ${r.message}` : ""})`
  );
}

export interface BufferChannel {
  id: string;
  service: string;
  name: string;
  isDisconnected: boolean;
}

/** All channels across the account's organizations — diagnostics/verify only. */
export async function listChannels(): Promise<BufferChannel[]> {
  const orgs = await bufferGql(`query GetOrganizations { account { organizations { id } } }`);
  const out: BufferChannel[] = [];
  for (const org of orgs?.account?.organizations ?? []) {
    const data = await bufferGql(
      `query GetChannels($input: ChannelsInput!) { channels(input: $input) { id name displayName service isDisconnected } }`,
      { input: { organizationId: org.id } }
    );
    for (const c of data?.channels ?? []) {
      out.push({
        id: String(c.id),
        service: String(c.service),
        name: String(c.displayName ?? c.name ?? ""),
        isDisconnected: !!c.isDisconnected,
      });
    }
  }
  return out;
}

/** Buffer as a PublishEngine (lib/publish-engine.ts). Ids are RAW Buffer ids; the `buffer:` prefix lives only in Notion. */
export const bufferEngine: PublishEngine = {
  key: "buffer",
  createScheduledPost: (opts) => createScheduledPost(opts),
  getPostState: (id) => getPostState(id),
  deletePost: (id) => deletePost(id),
};
