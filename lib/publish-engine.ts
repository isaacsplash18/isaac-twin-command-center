/**
 * Publishing-engine interface. Typefully (lib/typefully.ts) and Buffer
 * (lib/buffer.ts) both implement it; lib/publisher.ts and lib/actions.ts only
 * talk to this seam, never to a vendor client directly.
 *
 * ── Which engine? ─────────────────────────────────────────────────────────
 *  - NEW posts: engineForNewPosts() reads PUBLISH_ENGINE (default "typefully";
 *    an unknown value throws — config.ts has already failed closed to manual).
 *  - EXISTING posts: engineForId()/parseStoredId() route per item from the id
 *    already stored in Notion, so a cutover is safe with a mixed queue.
 *
 * ── ID routing (the "Typefully ID" Notion property) ───────────────────────
 * The Notion property is still named "Typefully ID" — renaming it would not be
 * additive and would break every existing reader. It now holds an engine-tagged
 * id:
 *     "<typefullyDraftId>"      un-prefixed → Typefully (ALL historical data)
 *     "buffer:<bufferPostId>"   prefixed    → Buffer
 * The reconciler and rollback/unqueue call parseStoredId() per item, so
 * Typefully items queued before the flip keep reconciling against Typefully
 * (and unqueue deletes via Typefully) after PUBLISH_ENGINE=buffer, and
 * Buffer items keep working after a rollback to PUBLISH_ENGINE=typefully. The
 * prefix is stripped before any vendor API call. Nothing that has no prefix is
 * ever sent to Buffer.
 */

import { BUFFER_ID_PREFIX, parsePublishEngine, PublishEngineKey } from "./config";
import { typefullyEngine } from "./typefully";
import { bufferEngine } from "./buffer";

export type { PublishEngineKey };

export type SchedulablePlatformKey = "x" | "linkedin" | "substack";

export interface PublishEngine {
  key: PublishEngineKey;
  /** Create a post scheduled for `publishAtIso`. Returns the vendor's RAW id (no engine prefix). */
  createScheduledPost(opts: {
    platform: SchedulablePlatformKey;
    body: string;
    publishAtIso: string;
  }): Promise<{ id: string; url?: string | null }>;
  /** `status` is "published" once live (vendor-specific values otherwise); `id` is the RAW vendor id. */
  getPostState(id: string): Promise<{ status: string; publishedUrl: string | null }>;
  deletePost(id: string): Promise<void>;
}


const ENGINES: Record<PublishEngineKey, PublishEngine> = {
  typefully: typefullyEngine,
  buffer: bufferEngine,
};

/** Human label for the engine, used in Pipeline Event notes ("Typefully draft …" / "Buffer post …"). */
export const ENGINE_LABEL: Record<PublishEngineKey, string> = { typefully: "Typefully", buffer: "Buffer" };

/** Engine that creates NEW posts. Throws on an invalid PUBLISH_ENGINE (never guess which vendor to post through). */
export function engineForNewPosts(env: Record<string, string | undefined> = process.env): PublishEngine {
  const key = parsePublishEngine(env.PUBLISH_ENGINE);
  if (!key) throw new Error(`Invalid PUBLISH_ENGINE "${env.PUBLISH_ENGINE}" — expected "typefully" or "buffer"`);
  return ENGINES[key];
}

/** Which engine a Notion-stored id belongs to (pure, no env, no network). */
export function engineKeyForId(storedId: string): PublishEngineKey {
  return storedId.startsWith(BUFFER_ID_PREFIX) ? "buffer" : "typefully";
}

/** Encode a vendor id for storage in the "Typefully ID" property. Typefully ids stay un-prefixed. */
export function toStoredId(key: PublishEngineKey, rawId: string): string {
  return key === "buffer" ? `${BUFFER_ID_PREFIX}${rawId}` : rawId;
}

/** Engine + RAW vendor id for a stored id (prefix stripped). */
export function parseStoredId(storedId: string): { engine: PublishEngine; id: string } {
  const key = engineKeyForId(storedId);
  return { engine: ENGINES[key], id: key === "buffer" ? storedId.slice(BUFFER_ID_PREFIX.length) : storedId };
}

/** Engine for an existing stored id. Callers pass the RAW id from parseStoredId() to the engine methods. */
export function engineForId(storedId: string): PublishEngine {
  return parseStoredId(storedId).engine;
}
