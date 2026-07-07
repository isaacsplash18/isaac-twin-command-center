# Hermes Integration — Machine Export (Phase 5)

*Companion to `docs/hermes-calibration-plan.md` §4.3. This is the reference for
Hermes (or any other machine consumer) reading Command Center calibration
state over HTTP.*

## Purpose

`GET /api/hermes/export` gives Hermes a single, read-only, machine-readable
snapshot of:

- recent **CalibrationEvents** (the structured log of Isaac's approve/reject/
  edit/confirm/sharpen/reject/submit/later actions),
- pending and accepted **PositionUpdateProposals** (deterministic, human-
  reviewable proposed changes to canonical Positions — never auto-generated
  beliefs),
- how many drafts are currently waiting for Isaac's review, and
- the publisher's current mode (manual copy-paste vs. Typefully auto-publish).

It is part of the **machine lane** (`docs/hermes-calibration-plan.md` §4.3,
distinct from the human session-cookie lane and the Vercel cron lane). It is
**read-only** — nothing about this endpoint mutates Notion.

## Auth

Send `Authorization: Bearer ${HERMES_API_TOKEN}` on every request.

- `HERMES_API_TOKEN` is a new env var (`.env.example`, mirrored to Vercel).
  Generate one with:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- If `HERMES_API_TOKEN` is unset on the server, the machine lane is **disabled
  entirely** — every request to `/api/hermes/*` returns `401` regardless of
  what `Authorization` header is sent. This is the same fail-closed pattern as
  `CRON_SECRET` in `app/api/cron/publish/route.ts`.
- The comparison is constant-time (`lib/machine-auth.ts`, reusing
  `timingSafeEqualStr` from `lib/auth.ts`) — no timing side-channel on the
  token.
- `/api/hermes/` is listed in `middleware.ts`'s `PUBLIC_PREFIXES` (alongside
  `/api/cron/`) because it **self-authenticates** — the human session-cookie
  middleware check is skipped for this prefix, and the route itself is the
  only auth gate. Do not rely on middleware to protect it.
- The token is never logged, never echoed back in any response, and never
  appears in the export payload.

## `GET /api/hermes/export`

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `since` | ISO 8601 string | 7 days ago | Filters `events` to CalibrationEvents created on or after this timestamp. Invalid/unparseable values fall back to the default silently. Does **not** filter `proposals` (proposals are a small, status-scoped list, not a time-windowed log). |
| `limit` | integer | `100` | Caps `events` length. Values above `200` are clamped to `200`; non-positive or non-numeric values fall back to `100`. Does not affect `proposals` (capped at 100 internally by `queryProposals`). |

### Example request

```bash
curl -s \
  -H "Authorization: Bearer $HERMES_API_TOKEN" \
  "https://isaac-twin-command-center.vercel.app/api/hermes/export?since=2026-06-30T00:00:00Z&limit=50"
```

Local dev:

```bash
curl -s \
  -H "Authorization: Bearer $HERMES_API_TOKEN" \
  "http://localhost:3000/api/hermes/export"
```

### Example response

```jsonc
{
  // Bumped only on a breaking change to this shape. Consumers should check
  // this before assuming any field is present.
  "version": 1,

  // When this snapshot was generated (always "now" — not cached).
  "generatedAt": "2026-07-07T09:12:03.441Z",

  // The effective `since` used for `events` (echoes the resolved default if
  // the query param was omitted or invalid).
  "since": "2026-06-30T09:12:03.441Z",

  // Recent CalibrationEvents, newest first. Shape: lib/calibration-events.ts
  // `CalibrationEvent`. Empty array if DS_CALIBRATION_EVENTS is unset.
  "events": [
    {
      "id": "1a2b3c4d-...",
      "createdAt": "2026-07-06T14:02:11.000Z",
      "source": "command_center",
      "objectType": "calibration_card",
      "objectId": "block-abc123",
      "platform": "unknown",
      "topic": "Should Isaac take unsolicited investor calls?",
      "action": "sharpen",
      "rawUserText": "Only if a mutual intro vouches for them first.",
      "previousText": "",
      "newText": "",
      "affectedPositionIds": ["7f8e9d-position-page-id"],
      "inferredDelta": "position-sharpened",
      "status": "pending"
    }
  ],

  "proposals": {
    // Reviewable, not-yet-decided proposed changes to a canonical Position.
    // Shape: lib/proposals.ts `PositionUpdateProposal`.
    "pending": [
      {
        "id": "proposal-page-id-1",
        "createdAt": "2026-07-06T14:02:12.000Z",
        "updatedAt": "2026-07-06T14:02:12.000Z",
        "sourceEventIds": ["1a2b3c4d-..."],
        "affectedPositionId": "7f8e9d-position-page-id",
        "topic": "Unsolicited investor calls",
        "currentPositionText": "Take unsolicited investor calls\nBasis: ...",
        "proposedPositionText": "Only if a mutual intro vouches for them first.",
        "reason": "Isaac's own words from a SHARPEN verdict on the weekly survey",
        "evidenceSummary": "sharpen · event 1a2b3c4d-... · 2026-07-06T14:02:11.000Z",
        "confidence": "medium",
        "status": "pending"
      }
    ],

    // IMPORTANT: "accepted" means Isaac clicked ACCEPT in the PROPOSED
    // UPDATES panel — it does NOT mean the proposed text has been written to
    // the canonical Positions Library, the survey page, or the twin repo.
    // `accepted ≠ applied` (docs/hermes-calibration-plan.md §8 rule 5).
    // Hermes MUST NOT treat anything in this array as canonical identity —
    // it is "approved for consideration", still pending a manual apply step.
    // Applying stays a human action in v1; there is no automated path yet.
    "accepted": []
  },

  // Count of Status=Draft pages across the 4 content DBs (X, LinkedIn,
  // IG Story, IG Carousel) — i.e. drafts waiting in the approval queue.
  "drafts": { "pendingReview": 3 },

  // Derived the same way as lib/config.ts's TYPEFULLY_ENABLED: "typefully"
  // when TYPEFULLY_API_KEY is set (and PUBLISH_MODE != "manual"), else
  // "manual". The key itself is never included in this or any response.
  "publisher": { "mode": "manual" },

  // Non-fatal notices about lanes that returned empty/zero because an env
  // var isn't configured yet (or a DB isn't migrated). Empty array when
  // everything is fully configured. Always present (stable shape).
  "warnings": [
    "DS_PROPOSALS not configured — proposals.pending/accepted are empty"
  ]
}
```

### Field-by-field notes

- **`events`** — newest first (Notion `created_time` descending). Empty when
  `DS_CALIBRATION_EVENTS` is unset; a matching entry appears in `warnings`.
- **`proposals.pending`** — awaiting Isaac's ACCEPT/REJECT in the Command
  Center UI. Not canonical.
- **`proposals.accepted`** — Isaac has accepted the *proposal itself* for
  further consideration, but the text has **not** been written back to the
  Positions Library, the weekly survey, or the twin repo. **Hermes must not
  treat these as the current canonical position.** There is no `applied`
  state reachable yet in v1 — that is reserved for a future explicit "apply"
  action, which will always require a separate human step.
- **`drafts.pendingReview`** — a simple count, not the drafts themselves. Use
  the (session-authed, human-lane) `GET /api/queue` endpoint from the Command
  Center UI if you need the actual draft bodies; this export intentionally
  keeps draft content out of the machine lane for now (Phase 7, the draft
  *creation* bridge, is separate and one-directional: Hermes → Command
  Center).
- **`publisher.mode`** — `"manual"` means every approved draft still requires
  Isaac to copy-paste and mark-posted by hand; `"typefully"` means X/LinkedIn
  auto-publish via Typefully is live. Either way, publishing always requires
  prior human approval of the draft (§8 constraint 4 in the plan / guardrail
  1–2 in the build brief) — this field is status only, not a control.
- **`warnings`** — always an array (possibly empty). Each entry names the
  specific env var or lane that's unconfigured. This lets Hermes distinguish
  "genuinely zero events" from "the events lane isn't wired up yet."

### Error codes

| Status | Body | Meaning |
|---|---|---|
| `200` | export JSON (see above) | Success — note `warnings` may still be non-empty. |
| `401` | `{"error":"Unauthorised"}` | Missing/wrong `Authorization` header, or `HERMES_API_TOKEN` is unset server-side (machine lane disabled). |
| `500` | `{"error":"<message>"}` | Unexpected failure (e.g. Notion API error not covered by a lane's own degrade-gracefully handling). Retry with backoff; this is not expected in normal operation. |

### Versioning

This is a **stable, documented contract**. `version: 1` today. Any breaking
change (removed field, changed type, changed semantics of an existing field)
bumps `version` and is called out here and in
`docs/hermes-calibration-plan.md` §9. Additive changes (new optional fields)
do not bump `version`.

## Verification

`scripts/verify-hermes-export.ts` (`npm run verify:hermes-export -- --url
http://localhost:3000`):

- If `HERMES_API_TOKEN` is unset, prints "machine lane disabled — set
  HERMES_API_TOKEN" and exits `0` (the app must keep working pre-configuration).
- Otherwise: confirms a request **without** the `Authorization` header gets
  `401`, confirms a request **with** it gets `200`, and structurally validates
  the response — every required key present with the right type, all
  timestamps parse as valid dates, `events` sorted newest-first, and no key
  anywhere in the payload whose name looks like `token`/`secret`/`key` (a
  guard against accidentally leaking a credential in a future edit).

## Limitations

- `since` only filters `events`; `proposals` are always the full
  pending/accepted lists (capped at 100 each by `queryProposals`). If proposal
  volume grows, this endpoint will need pagination — not built in v1.
- No pagination cursor for `events` either — `limit` is a hard cap, not a
  paged cursor. For single-user volume this is expected to be fine.
- `drafts.pendingReview` is a count only; fetching actual draft bodies over
  the machine lane is out of scope until Phase 7 (draft creation bridge) —
  and even then that's a one-way Hermes → Command Center write, not a read of
  existing drafts.
- No rate limiting on this endpoint (matches the rest of the app — single
  trusted caller, Hermes, expected).

## Draft creation — POST /api/hermes/drafts

*Phase 7 — docs/hermes-calibration-plan.md §4.4. This is the one-way
Hermes → Command Center write: Hermes (or any other machine caller) creates a
new draft; a human still approves/edits/rejects it in the existing approval
queue, exactly as if Isaac had written it himself in Notion.*

### Purpose

Lets Hermes create a pending draft directly in the right content database
(X / LinkedIn / IG Story / IG Carousel) instead of Isaac hand-pasting Hermes
output into Notion. The draft lands with `Status: Draft` — the app's existing
"pending review" state — so it appears in the Command Center approval queue
with **zero UI changes**. This route **never publishes** and **never sets any
status other than `Draft`**.

### Auth

Same machine lane as the export endpoint: send
`Authorization: Bearer ${HERMES_API_TOKEN}`. `/api/hermes/` is already in
`middleware.ts`'s `PUBLIC_PREFIXES` (added in Phase 5) — no middleware change
was needed for this route. Missing/wrong header, or `HERMES_API_TOKEN` unset
server-side → `401`.

### Request

`POST /api/hermes/drafts`, JSON body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `platform` | string | yes | `x`, `linkedin`, `ig-story`, `ig-carousel` — or the export schema's snake_case aliases `ig_story` / `ig_carousel` (both are normalized to the same platform). Unknown value → `400`. |
| `title` | string | yes | Goes into the content DB's title property (`Hook` for X/LinkedIn; the same discovery Notion uses for the other DBs). Empty/whitespace-only → `400`. |
| `body` | string | yes | Placement depends on platform — see below. Empty/whitespace-only, or over 20,000 characters, → `400`. |
| `sourcePositionIds` | string[] | no | Notion Position page ids Hermes drafted from. Stored verbatim, comma-joined, in the `Source Position IDs` property (added by this phase's migration — a dedicated property, not folded into `Source Workflow`). |
| `sourceWorkflow` | string | no | Free text (e.g. a workflow/pack name) stored in the `Source Workflow` rich-text property. |
| `humanizerStatus` | `"passed" \| "failed" \| "unknown"` | no | Defaults to `"unknown"`. Stored in the `Humanizer` select property. **This is a label Hermes supplies — the humanizer gate itself runs Hermes-side (`humanizer_check.py`); the Command Center only records the result, it does not run or verify the check.** |
| `createdBy` | `"hermes" \| "agent"` | no | Defaults to `"hermes"`. Stored in the `Created By` select property (which also has a `"manual"` option for human-created drafts, never set by this route). |

### Per-platform body placement

Mirrors the existing read-side convention (`lib/items.ts` `readItemBody`), in
reverse:

| Platform | Title property | Body placement |
|---|---|---|
| `x` | `Hook` | Page content — split on blank lines into paragraph blocks (same chunking as the existing edit path), passed as `children` on page create. |
| `linkedin` | `Hook` | Page content, same as X. |
| `ig-story` / `ig_story` | (DB's title property) | `IG Story Copy` rich-text property. |
| `ig-carousel` / `ig_carousel` | (DB's title property) | `Caption` rich-text property. `Slide Texts` is not written by this route (no per-slide field in the request shape — v1 sends the caption only). |

### Example request

```bash
curl -s -X POST \
  -H "Authorization: Bearer $HERMES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "x",
    "title": "Why I stopped taking cold investor calls",
    "body": "Most cold investor outreach is a templated deck with my name swapped in.\n\nI now only take calls with a mutual intro — it filters for signal.",
    "sourceWorkflow": "packs/workflows/x.md",
    "sourcePositionIds": ["7f8e9d-position-page-id"],
    "humanizerStatus": "passed",
    "createdBy": "hermes"
  }' \
  "https://isaac-twin-command-center.vercel.app/api/hermes/drafts"
```

Local dev:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $HERMES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"x","title":"Test draft","body":"Body text."}' \
  "http://localhost:3000/api/hermes/drafts"
```

### Example response (201)

```jsonc
{
  "id": "2a3b4c5d-...",
  "url": "https://www.notion.so/2a3b4c5d-...",
  "platform": "x",
  "status": "Draft",
  // Non-empty only if the 4 provenance properties (Created By / Source
  // Workflow / Humanizer / Source Position IDs) aren't migrated onto this
  // content DB yet — the draft is still created, just without them. Run
  // `npm run migrate` to clear this.
  "warnings": []
}
```

### Error codes

| Status | Body | Meaning |
|---|---|---|
| `201` | draft JSON (see above) | Created — lands in the approval queue as `Status: Draft`. |
| `400` | `{"error":"<message>"}` | Validation failure: unknown `platform`, missing/empty `title` or `body`, or `body` over 20,000 characters. The message names the specific problem. |
| `401` | `{"error":"Unauthorised"}` | Missing/wrong `Authorization` header, or `HERMES_API_TOKEN` is unset server-side (machine lane disabled). |
| `500` | `{"error":"<message>"}` | Unexpected failure (e.g. a genuine Notion API error not covered by the pre-migration fallback). Retry with backoff; not expected in normal operation. |

### Important: this is a queue entry, not a publish

A draft created through this endpoint is **identical in every way** to a
draft Isaac wrote by hand in Notion: it sits at `Status: Draft`, shows up in
the Command Center approval queue, and requires an explicit APPROVE (and,
for X/LinkedIn with Typefully enabled, a subsequent queue/publish step) before
it goes anywhere near a real platform. **Nothing about this endpoint
publishes, schedules, or auto-approves anything.** `humanizerStatus` is stored
as-is for visibility/audit — the Command Center does not re-run or verify the
humanizer gate; that check happens entirely on the Hermes side.

### Verification

`scripts/verify-draft-bridge.ts` (`npm run verify:draft-bridge -- --url
http://localhost:3000`):

- If `HERMES_API_TOKEN` is unset, prints "machine lane disabled — set
  HERMES_API_TOKEN" and exits `0`.
- Otherwise: asserts an unauthenticated request and a wrong-token request both
  get `401`; asserts a request with an unknown `platform` and one with an
  empty `title` both get `400`; creates one throwaway X draft titled
  `VERIFY-DRAFT-BRIDGE — safe to delete` with a two-paragraph body, asserts
  `201` plus a well-shaped response, reads the created Notion page back and
  asserts `Status` is `Draft`, the title matches, and the body round-trips
  exactly through the paragraph-block split/join — then archives the test
  page. PASS/FAIL per assertion.

### Limitations

- `sourcePositionIds` is stored as a flat comma-joined string in the
  `Source Position IDs` rich-text property, not a relation — consistent with
  the rest of this system's stance on cross-DB relations (Phase 3 §4.1):
  ids aren't validated against the Positions Library, and a comma inside an id
  would break the join (Notion page ids never contain commas, so this is safe
  in practice).
- IG Carousel drafts created this way only populate `Caption`; `Slide Texts`
  is left blank (no per-slide field exists in this request shape yet).
- The four provenance properties are additive Notion schema (this phase's
  migration). Until `npm run migrate` has been run against a given content
  DB, drafts are still created successfully, just without `Created By` /
  `Source Workflow` / `Humanizer` / `Source Position IDs` set — surfaced as a
  `warnings` entry in the response rather than a hard failure.
- No de-dup: calling this endpoint twice with the same content creates two
  separate draft pages. Idempotency (e.g. a client-supplied request id) is not
  implemented in v1.

## Publisher gating (Phase 10)

The publishing layer predates the calibration system and already satisfies the
brief's Phase 10 requirements. This section documents the guarantees rather
than adding new machinery.

### Guarantees, and where they're enforced

| Brief requirement | Implementation |
|---|---|
| Never publish without explicit approval | `lib/publisher.ts` `runPublisher()` only queries items with `Status: Approved` — a status that is only ever set by Isaac's Approve action (web UI today; Telegram bridge after Phase 9). There is no code path from `Draft` to Typefully. |
| Publisher status stored | Notion `Status` select is the state machine. Mapping to the brief's vocabulary: `Approved` = *not_queued*, `Queued` = *queued*, `Posted` = *published*; failures stay `Approved` and log a `Publish-failed` Pipeline Event (= *failed*, retried next cron run). |
| Publisher URL/id stored | `Typefully ID` and `Scheduled At` props on the content page. |
| Failures surfaced | Dashboard banner (via `/api/panels`) and, machine-side, `publisher.failures24h` in `GET /api/hermes/export`. |
| Retry-safe | Idempotency by construction: items already carrying a `Typefully ID` are skipped; cron re-runs never double-schedule. The hourly reconciler (`/api/cron/reconcile`) flags items >2h past their slot exactly once. |
| No automatic publishing by default | With `TYPEFULLY_API_KEY` unset (current state), every platform runs the manual copy-paste lane; `runPublisher()` iterates zero auto-publish platforms and is a no-op. `publisher.mode` in the export reports `"manual"`. |
| Missing credentials ⇒ interface + dry-run only | Exactly the current state: the full Typefully v2 interface exists (`lib/typefully.ts`) and is inert without the key. Setting the key is the only switch. |

### Turning zero-touch publishing on (later)

Set `TYPEFULLY_API_KEY` (and optionally `TYPEFULLY_SOCIAL_SET_ID`) in Vercel.
Slots: X daily 08:30 SGT, LinkedIn Mon/Wed/Fri 09:00 SGT. Before enabling,
update the Sunday cleanup automation so it skips `Queued` items (standing
coordination note from the Command Center build).
