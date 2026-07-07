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
