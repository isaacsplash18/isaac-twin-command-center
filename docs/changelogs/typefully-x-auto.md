# Typefully auto-publishing — X only

*Scopes zero-touch Typefully publishing to X. LinkedIn stays in the manual
copy-paste lane (Approve → COPY → Mark Posted) even once a Typefully key is
set, until it's explicitly opted in. Companion docs:
`docs/hermes-integration.md` ("Publisher gating (Phase 10)" section,
`autoPlatforms` field note) and `lib/typefully.ts`'s header comment.*

## What changed

- `lib/config.ts` — added `TYPEFULLY_PLATFORMS`, a comma-separated env var
  parsed once into a `Set<string>` (default `{"x"}` when unset/empty). Each
  platform's `autoPublish` is now `TYPEFULLY_ENABLED && TYPEFULLY_PLATFORMS.has(key)`
  instead of the previous `TYPEFULLY_ENABLED` alone — so setting a key no
  longer silently flips LinkedIn to auto-publish too. Exported the parsing as
  a pure `parseTypefullyPlatforms(raw)` helper so it's testable without
  mutating `process.env`. IG platforms are unaffected (still hardcoded
  `autoPublish: false`).
- `lib/typefully.ts` — reconciled against the current Typefully v2 API docs:
  - `getDraftState` now normalizes both the legacy `status` field and the
    current API's `publish_state` field — reports `status: "published"` when
    either `status === "published"` or `publish_state === "finished"`.
    `DraftState` shape (`{ status, publishedUrl }`) is unchanged, so
    `lib/publisher.ts` needed no changes.
  - Added `listSocialSets()` (id + name only) for diagnostics/verification —
    not used by the publisher/reconciler cores, which keep pinning/resolving
    a single social set exactly as before.
  - `publish_at` scheduling is unchanged: still our own SGT slot math from
    `lib/scheduling.ts`, passed as an ISO 8601 timestamp — never `"now"` or
    `"next-free-slot"`.
- `app/api/hermes/export/route.ts` — additive: the `publisher` object now
  includes `autoPlatforms: string[]` (the `PLATFORMS` keys whose
  `autoPublish` is currently true). `version` is unchanged (`1`).
- `scripts/verify-typefully.ts` (new) — always prints the resolved mode and
  per-platform `autoPublish` flags, and asserts the gating formula (including
  "no key → everything manual") via `parseTypefullyPlatforms`. With
  `TYPEFULLY_API_KEY` set and `--live` passed, exercises the real API: lists
  social sets, creates a scheduled X draft ~1 year out (never publishes
  immediately), fetches its state, then deletes it in a `finally`. No key or
  no `--live` → live section skipped, exit `0`.
- `package.json` — added `"verify:typefully": "tsx scripts/verify-typefully.ts"`.
- `.env.example` — added `TYPEFULLY_PLATFORMS=` with a comment (default `x`).
- `docs/hermes-integration.md` — documented `autoPlatforms` in the sample
  response and field notes, and updated "Turning zero-touch publishing on
  (later)" to mention `TYPEFULLY_PLATFORMS` (default `x`).
- `components/QueuePanel.tsx` / `app/api/queue/route.ts` — reviewed, no
  change needed. The queue already lanes purely off each item's
  `p.autoPublish` (computed in `lib/config.ts`), and the UI copy ("APPROVED —
  AWAITING SCHEDULER", "SCHEDULED") is platform-agnostic, so it reads
  correctly whether zero, one, or both platforms are auto-publishing.

## Env vars

- `TYPEFULLY_API_KEY` — unchanged. Presence (with `PUBLISH_MODE` unset or not
  `"manual"`) is still what turns `TYPEFULLY_ENABLED` on.
- `TYPEFULLY_SOCIAL_SET_ID` — unchanged, optional; pins a social set.
- `TYPEFULLY_PLATFORMS` — **new**, optional. Comma-separated platform keys
  from `{x, linkedin}` that should auto-publish once `TYPEFULLY_ENABLED` is
  true. Default (unset or empty) is `"x"`. Case-insensitive, whitespace
  around commas is trimmed. Any key not in the set stays in the manual
  copy-paste lane regardless of the Typefully key.
- `PUBLISH_MODE=manual` — unchanged kill switch; forces every platform back
  to manual regardless of `TYPEFULLY_API_KEY` / `TYPEFULLY_PLATFORMS`.

## How the crons pick it up

No changes to `lib/publisher.ts` or `lib/reconciler`/`runReconciler` logic —
both already iterate `PLATFORMS.filter((p) => p.autoPublish)`, so scoping
`autoPublish` per platform in `lib/config.ts` is enough: the publisher cron
will only ever pick up `Approved` X items into Typefully, and the reconciler
will only ever poll Typefully for X's `Queued` items. LinkedIn `Approved`
items keep flowing into the existing "APPROVED — POST MANUALLY" lane in the
Command Center UI exactly as they do today in full-manual mode.

## Rollback

Any of:
- Unset `TYPEFULLY_API_KEY` — disables auto-publishing for every platform
  (back to full-manual), as before this change.
- Set `PUBLISH_MODE=manual` — same effect, key stays configured for later.
- Set `TYPEFULLY_PLATFORMS=` (empty) or leave it unset — X auto-publish stays
  the *default* once a key is set, so to fully disable without touching the
  key, set `TYPEFULLY_PLATFORMS` to a value that names no real platform,
  e.g. `TYPEFULLY_PLATFORMS=none`, or prefer `PUBLISH_MODE=manual`.

`git revert` this change removes the `TYPEFULLY_PLATFORMS` gate (reverting to
"any Typefully key auto-publishes X *and* LinkedIn"), the `getDraftState`
`publish_state` normalization, `autoPlatforms` in the export, and the new
verify script. No Notion schema change, no migration to undo.

## Precondition before flipping this on for real

Per the existing Phase 10 note in `docs/hermes-integration.md`: before
setting `TYPEFULLY_API_KEY` in Vercel, update the Notion "Sunday cleanup"
automation so it skips `Queued` items — otherwise it can delete/reset items
the publisher just handed to Typefully out from under the reconciler. This
was already true for the old both-platforms gate and remains true now that
the default scope is X only.

## How to verify

1. `npx tsc --noEmit` — clean.
2. `npm run verify:typefully` — keyless mode: prints the resolved mode/flags
   and runs the gating-formula assertions, PASS on every line, exits `0`.
3. With a real `TYPEFULLY_API_KEY` configured: `npm run verify:typefully --
   --live` — lists social sets, creates and immediately deletes a throwaway
   scheduled X draft (`publish_at` ~1 year out), never publishes anything.
4. Not run in this change: `npx next build` (owned by the orchestrator gate)
   and the live section above (needs a real Typefully key).
