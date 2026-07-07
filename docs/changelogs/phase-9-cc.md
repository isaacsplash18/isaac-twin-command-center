# Phase 9 (Command Center side) — Telegram Approval Bridge

*Implements the Command Center half of `docs/telegram-approval-bridge.md` —
section §2 (the two new machine-lane endpoints), §5 (edit = edit-then-approve),
§6 (rejection → CalibrationEvent), and step (a) 1–5 of §9. The Hermes-side
worker (§9 step (b), the Python launchd job) is a separate change. Companion
doc: `docs/hermes-integration.md` → "Draft read (pending)" and "Decision
write-back" sections.*

## Files changed

- `lib/actions.ts` — threaded an optional, **default-preserving** calibration
  `source` (and, for reject, an optional `reason`) into the three lifecycle
  actions, passed through to the existing `logCalibrationEvent({...})` calls.
  New signatures:
  - `approveItem(pageId: string, source: CalibrationSource = "command_center")`
  - `rejectItem(pageId: string, source: CalibrationSource = "command_center", reason?: string)`
    — `reason` is logged as the reject CalibrationEvent's `rawUserText` (which
    was previously unset — additive, design §6).
  - `editItem(pageId: string, newText: string, source: CalibrationSource = "command_center")`

  The existing web-UI route callers pass no new args, so they keep logging
  `source: "command_center"` unchanged. Nothing else in these functions changed
  (same status guards, same 409 `ActionError`, same Pipeline Events). Added
  `CalibrationSource` to the existing `./calibration-events` import.
- `app/api/hermes/decisions/route.ts` (new) — `POST`, `dynamic =
  "force-dynamic"`, machine lane via `isMachineAuthorized` (→ `401`). Body:
  `{ pageId, action: "approve"|"reject"|"edit", editedText?, reason?, source?,
  idempotencyKey? }`. Validates (`400`): non-JSON body, missing `pageId`,
  invalid `action`, or `edit` without `editedText`. Dispatch:
  `approve → approveItem(pageId, source)`;
  `reject → rejectItem(pageId, source, reason)`;
  `edit → editItem(pageId, editedText, source)` **then**
  `approveItem(pageId, source)` (the single EDIT-APPROVE, design §5). `source`
  defaults to `"telegram"` for this route (an invalid value falls back to
  `"telegram"`). **409 → no-op translation:** a `409 ActionError` from a wrapped
  action (page already off `Draft`) is caught and returned as
  `200 { ok:true, pageId, action, status, noop:true, note:"already-decided" }`
  (the current status is re-read via `getPage`/`readStatus` for the response) —
  a duplicate/stale decision is success for the bridge. All other errors mirror
  `handleAction`: `ActionError` → its status, anything else → `500`. Success →
  `200 { ok:true, pageId, action, status, noop:false }`. `idempotencyKey` is
  echoed when supplied. Never touches `middleware.ts` — `/api/hermes/` is
  already public/self-authenticating (Phase 5).
- `app/api/hermes/drafts/route.ts` — added a `GET` handler alongside the
  untouched Phase 7 `POST`. `?status=pending` (only value supported in v1;
  anything else → `400`) → machine lane → returns a bare JSON array
  `[{ pageId, platform, title, body, humanizer, createdBy, createdAt }]` across
  the 4 content DBs, newest first. Bodies come from
  `itemsWithStatus(p, "Draft", { withBody:true })`; `Humanizer` / `Created By`
  are read off each page via `readSelectProp` (they aren't carried on
  `ContentItem`). Degrades per-platform exactly like `export`: an unconfigured
  `DS_*` env var or a not-yet-migrated `Status` option is skipped (logged
  server-side), never failing the whole call. Updated the file header comment to
  document both verbs.
- `docs/hermes-integration.md` — appended two sections before "Publisher gating
  (Phase 10)": **"Draft read (pending) — GET /api/hermes/drafts?status=pending"**
  (purpose, auth, query params, curl examples, response array + field table,
  degradation, error table, limitations) and **"Decision write-back — POST
  /api/hermes/decisions"** (purpose, auth, request field table, per-action
  behaviour, the idempotency/no-op case, curl examples for
  approve/reject/edit, example 200 + noop responses, error table, verification).
- `scripts/verify-telegram-decisions.ts` (new) — mirrors
  `scripts/verify-draft-bridge.ts`. Exits `0` with "machine lane disabled — set
  HERMES_API_TOKEN" when the token is unset. Otherwise, over the machine lane:
  asserts `401` without/with-wrong token; creates throwaway
  `VERIFY-TG-DECISIONS — safe to delete` drafts and exercises `approve`
  (→ Notion `Approved`), `reject` with a reason (→ `Rejected`), and `edit`
  edit-then-approve (→ `Approved` + `Edited Before Approval` true); asserts a
  re-POSTed decision on the already-approved page returns
  `200 { noop:true, note:"already-decided" }`; then archives **every** test page
  it created (`archived:true`) in a `finally`, even on failure. Only ever
  touches its own throwaway pages.
- `package.json` — added `"verify:telegram-decisions": "tsx
  scripts/verify-telegram-decisions.ts"` (existing scripts preserved).
- this file (new).

## New behaviour

- A machine caller (the Telegram bridge worker) can now **read** pending drafts
  with bodies (`GET /api/hermes/drafts?status=pending`) and **write back** a
  decision (`POST /api/hermes/decisions`) over the existing Bearer-token machine
  lane — no human session cookie, no middleware change.
- Decisions produce the identical status change + Pipeline Event + Calibration-
  Event as the web-UI buttons, tagged `source: "telegram"`, with a reject
  `reason` now captured as `rawUserText`.
- Re-POSTing a decision on an already-decided page is a safe `200 noop:true`
  (status-based idempotency), so duplicate/stale Telegram replies can't
  double-apply or flip a Rejected item back.

## New env vars

None. Reuses `HERMES_API_TOKEN` (Phase 5). No new Notion properties or DBs —
idempotency is status-based only (design §2, O5); no migration.

## How to verify

1. `npx tsc --noEmit` — clean (run in this phase; the orchestrator owns `npx
   next build` at the gate).
2. Start a server with `HERMES_API_TOKEN` set (`npm run dev` or a deploy), then:
   `npm run verify:telegram-decisions -- --url <base-url>` — prints "machine lane
   disabled" and exits `0` if the token is unset; otherwise runs the auth +
   approve + reject-with-reason + edit-approve + 409-no-op assertions and
   archives its throwaway pages. PASS/FAIL per assertion.
3. Manual smoke test against a running server:
   ```bash
   # list pending drafts (with bodies)
   curl -s -H "Authorization: Bearer $HERMES_API_TOKEN" \
     "http://localhost:3000/api/hermes/drafts?status=pending"

   # approve one (use a pageId from the list above)
   curl -s -X POST -H "Authorization: Bearer $HERMES_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"pageId":"<id>","action":"approve"}' \
     "http://localhost:3000/api/hermes/decisions"
   ```
   The same requests without the `Authorization` header should return `401`, and
   a second approve on the same page should return `200 { noop:true }`.

## Limitations / uncertainties

- `GET ?status=pending` reads each draft's provenance selects with an extra
  `getPage` per draft (the pages `itemsWithStatus` fetched aren't re-exposed, and
  `lib/items.ts` was out of scope to change). Harmless at single-user pending-
  queue volume; a future optimisation could surface `Humanizer`/`Created By` on
  `ContentItem` to drop the extra reads.
- No key-based idempotency: `idempotencyKey` is accepted and echoed but dedup is
  purely status-based (design O5). Two *distinct* decisions racing the same page
  are resolved by whoever wins the `Draft` guard; the loser gets `noop:true`.
- The response of `GET ?status=pending` is a **bare array** (no envelope), so
  skipped/failed platforms are logged server-side rather than surfaced in the
  payload (unlike `export`'s `warnings[]`). This matches the design's documented
  array shape (§2 N2).
- Verify script asserts Notion status + `Edited Before Approval`; it does **not**
  assert the CalibrationEvent `source:"telegram"` round-trip (that would require
  `DS_CALIBRATION_EVENTS` configured, and `logCalibrationEvent` is a non-fatal
  no-op when it isn't — so asserting it would be flaky). The `source` tag is
  covered by the `lib/actions.ts` change + the export lane instead.
- Not run in this phase: `npx next build`, the live `verify:telegram-decisions`
  (needs a running server + token), and the Hermes-side Python worker (separate
  change). `npx tsc --noEmit` is the only build check run here.

## Rollback

`git revert` this phase's commit — removes `app/api/hermes/decisions/route.ts`,
the `GET` handler on `app/api/hermes/drafts/route.ts`, the `source`/`reason`
params on `lib/actions.ts` (reverting to the pre-Phase-9 signatures, all callers
still compile — the params were optional and defaulted), the
`verify:telegram-decisions` script entry, the verification script, and the docs
sections. No middleware change to revert (none made). No Notion schema change to
undo (status-based idempotency only). No canonical identity is ever touched:
a Telegram decision does exactly what the web-UI Approve/Reject/Edit buttons do.
As a runtime kill switch, unset `HERMES_API_TOKEN` — that disables the whole
machine lane (every `/api/hermes/*` → `401`), the bridge included.
