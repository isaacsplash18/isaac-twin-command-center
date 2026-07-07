# Phase 7 — Draft Creation Bridge

*Implements docs/hermes-calibration-plan.md §4.4 / §5 "P7" / build-brief.md
"Phase 7 — Draft Creation Bridge". Companion doc:
`docs/hermes-integration.md` → "Draft creation — POST /api/hermes/drafts".*

## Files changed

- `scripts/migrate.ts` — extended the existing `NEW_PROPS` additive set (the
  same object that already adds `Typefully ID` / `Scheduled At` / `Approved
  At` / `Edited Before Approval` / `Original Draft` to all 4 content DBs) with
  four new properties: `Created By` (select: `agent`/`hermes`/`manual`),
  `Source Workflow` (rich_text), `Humanizer` (select:
  `passed`/`failed`/`unknown`), `Source Position IDs` (rich_text). No new
  function, no restructuring of `main()` — purely additive entries in the
  existing dictionary, picked up by the existing `migrateContentDs()` loop.
  **Not run by this phase** — the orchestrator runs `npm run migrate`.
- `lib/items.ts` — added the inverse of `readItemBody`:
  - `normalizePlatformKey(input)` — accepts the app's hyphenated platform keys
    (`x`, `linkedin`, `ig-story`, `ig-carousel`) or the export schema's
    snake_case aliases (`ig_story`, `ig_carousel`); returns `null` for
    anything else.
  - `DraftInputError` — small local error class (`message` + `status`,
    default 400) so `createDraft` can produce clean 400-able messages without
    creating a circular import with `lib/actions.ts` (which already imports
    from `lib/items.ts`).
  - `createDraft(input)` — validates platform/title/body (empty checks, 20,000
    char body cap), resolves the title property via `titlePropertyName`,
    writes the body per platform convention (X/LinkedIn → page content via
    `children` on page create, chunked identically to `writeBody`'s blank-line
    split; IG Story → `IG Story Copy`; IG Carousel → `Caption`), sets `Status:
    Draft` via `buildStatusUpdate`, and writes the four provenance properties
    (`Created By` default `"hermes"`, `Humanizer` default `"unknown"`,
    `Source Workflow` when supplied, `Source Position IDs` as a comma-joined
    list when supplied). Provenance properties are written defensively: if the
    create fails because a content DB hasn't been migrated yet (Notion's
    "is not a property that exists" family of validation errors), the create
    is retried without them and a `warnings` entry is returned instead of a
    hard failure — mirroring the `approveItem` fallback pattern in
    `lib/actions.ts` (read, not modified, by this phase). Returns `{ id, url,
    platform, status: "Draft", warnings }`.
- `app/api/hermes/drafts/route.ts` (new) — `POST` only, `dynamic =
  "force-dynamic"`. `isMachineAuthorized` (Phase 5, unmodified) → `401`
  otherwise. Parses/coerces the JSON body, calls `createDraft`, returns `201`
  with the result. `DraftInputError` → `400` with the message; any other
  error → `500`, same shape as `app/api/hermes/export/route.ts`. Never touches
  `middleware.ts` — `/api/hermes/` is already public/self-authenticating from
  Phase 5.
- `docs/hermes-integration.md` — appended "## Draft creation — POST
  /api/hermes/drafts": auth, request field table, per-platform body-placement
  table, curl examples (prod + local), example 201 response, error table,
  explicit "this is a queue entry, not a publish" note (humanizerStatus is a
  label Hermes supplies; the Command Center never runs or verifies the
  humanizer gate itself), verification summary, limitations.
- `scripts/verify-draft-bridge.ts` (new) — if `HERMES_API_TOKEN` is unset,
  prints "machine lane disabled — set HERMES_API_TOKEN" and exits `0`.
  Otherwise: asserts unauthenticated and wrong-token requests both get `401`;
  asserts an unknown-platform request and an empty-title request both get
  `400`; creates one throwaway X draft (`VERIFY-DRAFT-BRIDGE — safe to
  delete`, two-paragraph body, `sourceWorkflow`/`humanizerStatus`/`createdBy`
  set), asserts `201` and a well-shaped response; reads the created page back
  via `lib/notion` (`getPage`/`readStatus`/`readTitle`/`readBody`) and asserts
  `Status` is `Draft`, the title matches, and the body round-trips exactly;
  archives the test page (cleanup) before exiting. PASS/FAIL per assertion,
  same style as `scripts/verify-hermes-export.ts`.
- `package.json` — added `verify:draft-bridge` script (`tsx
  scripts/verify-draft-bridge.ts`).
- this file (new).

## New env vars

None. Reuses `HERMES_API_TOKEN` (Phase 5) for auth; no new configuration
surface.

## How to verify

1. Orchestrator runs `npm run migrate` — extends the 4 content DBs with
   `Created By` / `Source Workflow` / `Humanizer` / `Source Position IDs`
   (idempotent; safe to re-run).
2. `npx next build` stays green (this phase ran `npx tsc --noEmit` only, per
   the parallel-batch constraint that the orchestrator owns `next build` at
   the gate — no type errors were found against the current tree).
3. `npm run verify:draft-bridge -- --url <base-url>` — prints "machine lane
   disabled" and exits `0` if `HERMES_API_TOKEN` is unset; otherwise runs the
   auth + validation + create + round-trip + cleanup assertions above and
   prints PASS/FAIL per check. Only ever creates and archives one throwaway
   draft page.
4. Manual smoke test against a real deployment:
   ```bash
   curl -s -X POST \
     -H "Authorization: Bearer $HERMES_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"platform":"x","title":"Test","body":"Body text."}' \
     https://isaac-twin-command-center.vercel.app/api/hermes/drafts
   ```
   should return `201` with a Notion page id; the new draft should then be
   visible in the Command Center approval queue at `Status: Draft`, and the
   same request without the `Authorization` header should return `401`.

## Limitations

- No de-dup / idempotency key — calling the endpoint twice with identical
  content creates two separate draft pages.
- `sourcePositionIds` is a flat comma-joined rich-text field (`Source Position
  IDs`), not a relation to the Positions Library and not validated against it
  — consistent with this system's existing stance that cross-DB relation ids
  aren't stable across data sources (Phase 3 §4.1). Ids are trusted as-is.
- IG Carousel drafts created via this route only set `Caption`; there's no
  per-slide field in the request shape, so `Slide Texts` is left blank.
- The four provenance properties degrade gracefully pre-migration (create
  succeeds, `warnings` explains what's missing) but there is no retro-fill —
  a draft created before migration will never retroactively gain `Created
  By`/`Humanizer`/etc.
- `humanizerStatus` is trusted verbatim from the caller; the Command Center
  does not independently verify it — the actual gate (`humanizer_check.py`)
  runs entirely on the Hermes side, by design (§4.4 / the constitution's
  "Hermes should not silently mutate canonical identity files" rule doesn't
  apply here since this is content, not identity, but the same
  don't-fabricate-verification spirit applies).
- Body length cap (20,000 chars) is an arbitrary but generous v1 limit; not
  configurable.

## Rollback

`git revert` this phase's commit — removes `app/api/hermes/drafts/route.ts`,
the `createDraft`/`normalizePlatformKey`/`DraftInputError` additions to
`lib/items.ts`, the `verify:draft-bridge` script entry, the verification
script, the docs section, and the `NEW_PROPS` additions in
`scripts/migrate.ts`. No middleware change to revert (none was made — Phase 5
already made `/api/hermes/` public). In Notion, the four new properties are
additive and harmless to leave in place even after a code revert (nothing
reads them once the route is gone); they can optionally be removed from each
content DB's schema in the Notion UI. No canonical data is ever touched by
this phase — creating a Draft-status page is exactly what a human does by
hand today, and drafts can always be rejected/archived like any other draft.
