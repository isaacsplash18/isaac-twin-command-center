# Buffer publishing engine (second engine, Typefully stays active)

*Adds Buffer as a second publishing engine behind a clean interface. With no new
env vars set, behaviour is unchanged: Typefully engine, same gating, same Notion
writes, same Pipeline Event text. Flipping to Buffer is a config change
(`PUBLISH_ENGINE=buffer`), reversible by flipping it back.*

## What changed

- `lib/publish-engine.ts` (new) - the `PublishEngine` interface
  (`createScheduledPost` / `getPostState` / `deletePost`), `engineForNewPosts()`
  (reads `PUBLISH_ENGINE`, default `typefully`, throws on an unknown value) and
  per-item routing by stored id: `parseStoredId` / `engineForId` / `toStoredId`.
- `lib/buffer.ts` (new) - Buffer adapter over the NEW GraphQL API
  (`POST https://api.buffer.com`, `Authorization: Bearer <token>`). Raw `fetch`,
  no dependencies. Doc URLs and exact operation names are in the file header.
- `lib/typefully.ts` - unchanged exports; adds `typefullyEngine` (thin wrapper).
- `lib/publisher.ts` - no direct Typefully imports. New posts go through
  `engineForNewPosts()`; the reconciler and the failed-Notion-write rollback
  route per item via the stored id. Slots / FIFO / idempotency unchanged.
- `lib/actions.ts` - `unqueueItem` deletes via the engine that owns the stored id.
- `lib/config.ts` - publishing gate is engine-aware (matrix below); new pure,
  testable helpers `computeAutoPublish`, `computeReconciles`,
  `computePublisherMode`, `parsePublishEngine`; `PUBLISHER_MODE` export.
  `TYPEFULLY_ENABLED` / `TYPEFULLY_PLATFORMS` / `parseTypefullyPlatforms` kept.
- `app/api/hermes/export/route.ts`, `app/api/agent/state/route.ts` -
  `publisher.mode` is now `"typefully" | "buffer" | "manual"` (additive; the
  value `"buffer"` is new, existing values unchanged). `verify-agent-api.ts` and
  `verify-hermes-export.ts` accept `"buffer"`.
- `scripts/verify-buffer.ts` + `npm run verify:buffer`; `.env.example` entries.

## ID routing (safe mixed-state cutover)

The Notion property is still called **"Typefully ID"** (renaming is not
additive). It now holds an engine-tagged id:

| Stored value | Engine |
| --- | --- |
| `<draftId>` (un-prefixed) | Typefully - all historical data |
| `buffer:<postId>` | Buffer |

The reconciler, `unqueueItem` and the rollback call `parseStoredId()` per item,
and the prefix is stripped before any Buffer API call. So Typefully items queued
before the flip keep reconciling (and unqueuing) against Typefully after
`PUBLISH_ENGINE=buffer`, and Buffer items keep working after a rollback.
`runReconciler` also now visits any platform where *either* engine is usable
(`computeReconciles`), so Queued items of the other engine are not stranded when
a platform has no Buffer channel yet / no Typefully platform listed.
Idempotency is unchanged: any non-empty "Typefully ID" means "already scheduled".

## Env vars

| Var | Purpose |
| --- | --- |
| `PUBLISH_ENGINE` | `typefully` (default) or `buffer`. Anything else = invalid = fail closed to manual. |
| `BUFFER_ACCESS_TOKEN` | Buffer personal API key (https://publish.buffer.com/settings/api). Server-only. |
| `BUFFER_CHANNEL_X` / `_LINKEDIN` / `_SUBSTACK` | Buffer channel ids. Channel id present = that platform auto-publishes (TYPEFULLY_PLATFORMS is ignored for Buffer). |
| `PUBLISH_MODE=manual` | Kill switch - still trumps everything, including the reconciler. |

### Gating matrix (`autoPublish`)

| `PUBLISH_ENGINE` | Env | x / linkedin / substack |
| --- | --- | --- |
| unset / `typefully` | no `TYPEFULLY_API_KEY` | manual / manual / manual |
| unset / `typefully` | key set, `TYPEFULLY_PLATFORMS` unset | auto / manual / manual (legacy) |
| unset / `typefully` | key set, `TYPEFULLY_PLATFORMS=x,linkedin,substack` | auto / auto / auto |
| unset / `typefully` | Buffer vars only | manual (Buffer env is inert) |
| `buffer` | token + all three channels | auto / auto / auto |
| `buffer` | token + `BUFFER_CHANNEL_X` only | auto / manual / manual |
| `buffer` | no token, or no channel for the platform | manual for that platform |
| `buffer` | Typefully key only | manual |
| anything | `PUBLISH_MODE=manual` | manual / manual / manual |
| invalid value | any | manual (fail closed) |

`publisher.mode`: `manual` if kill switch / invalid engine / missing credentials;
`typefully` if engine is typefully and a key exists; `buffer` if engine is buffer
and token + at least one channel id exist.

## Thread support verdict: SUPPORTED

Buffer's API supports X threads (`createPost` with
`metadata.twitter.thread: [{ text }]`, every post including the first; top-level
`text` must equal the first item; posts publish in order, each replying to the
previous - https://developers.buffer.com/examples/create-threaded-post.html).
So the `\n\n---\n\n` marker maps to a real thread, same semantics as Typefully.
LinkedIn / Substack ignore the marker and post one item (as on Typefully).
Guard kept: an empty thread segment (e.g. a trailing `---`) throws an
`ActionError` (422), so the item stays Approved with a Publish-failed event.

## Cutover runbook

1. Pick the cutover mode:
   - **Mixed (no waiting, supported):** do nothing special. Leave
     `TYPEFULLY_API_KEY` set; items queued in Typefully keep reconciling.
   - **Drain first (cleanest):** wait until no Typefully-queued items remain
     (`Queued` lane empty or all Posted), then flip. Remove the Typefully key later.
2. Locally: `BUFFER_ACCESS_TOKEN=... npm run verify:buffer -- --live` - prints
   channel ids (id + service + name), creates a post ~1 year out on the X channel,
   reads it back (expects `scheduled`), deletes it. Never publishes.
3. Put the printed channel ids in `BUFFER_CHANNEL_X`, `BUFFER_CHANNEL_LINKEDIN`,
   `BUFFER_CHANNEL_SUBSTACK` (only the platforms you want auto).
4. Vercel -> Project -> Environment Variables (Production): add
   `BUFFER_ACCESS_TOKEN`, the channel ids, and finally `PUBLISH_ENGINE=buffer`.
   Redeploy (config is read at module load).
5. Confirm `publisher.mode === "buffer"` and `autoPlatforms` in
   `GET /api/hermes/export`. Supervise one Approve -> publisher run -> check the
   post in Buffer (stored id `buffer:...`) -> try UNQUEUE on a throwaway.
6. **Kill switch:** `PUBLISH_MODE=manual` + redeploy - no scheduling, no
   reconciling, everything back to copy/paste.

## Rollback

Set `PUBLISH_ENGINE=typefully` (or remove it) and redeploy. New posts go to
Typefully again; Buffer-queued items (`buffer:` ids) still reconcile against
Buffer as long as `BUFFER_ACCESS_TOKEN` and a channel id for the platform stay set
(drop them only after those items are Posted).

## Verify

- `npm run verify:buffer` - keyless: engine parsing, id routing, gating /
  reconciler / mode matrices, thread + status mapping. No network.
- `npm run verify:buffer -- --live` - needs `BUFFER_ACCESS_TOKEN`.
- `npm run verify:typefully` - unchanged, still passes.

## Not confirmed without a live token

- Exact `deletePost` payload (`DeletePostSuccess { id }` | `VoidMutationError`)
  and that the selection set is accepted; the adapter only selects `__typename` +
  `... on DeletePostSuccess { id }` to stay valid under either shape.
- Whether the Substack channel Buffer exposes is Notes (our use) vs. longform.
- That a channel with a paused queue (`isQueuePaused`) still publishes
  `customScheduled` posts at `dueAt`.
- Buffer rejection modes (post limits, `LimitReachedError`) surface as a thrown
  error -> item stays Approved + Publish-failed event.
