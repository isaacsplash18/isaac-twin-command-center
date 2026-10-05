# Isaac Twin Command Center — Agent API (v1)

A bearer-token HTTP API that lets an external agent or app operate the Command Center without the browser login: read the queue, create drafts, make approve / reject / edit decisions, and review identity-calibration proposals. Everything is backed by the same Notion data and the same code paths as the web UI.

- **Base URL:** `https://isaac-twin-command-center.vercel.app`
- **Prefix:** all endpoints live under `/api/agent/`
- **Format:** JSON in, JSON out (`Content-Type: application/json` on POSTs with a body)

## Authentication

Every request needs:

```
Authorization: Bearer <AGENT_API_TOKEN>
```

- `AGENT_API_TOKEN` is a secret issued by the operator (Isaac). Keep it out of logs, prompts, and repos. The server never echoes it.
- It is **not** the Hermes token and **not** the browser session. Hermes' `HERMES_API_TOKEN` does not work here, and this token does not work on `/api/hermes/*`. The operator can revoke this lane alone by unsetting `AGENT_API_TOKEN` on the server (every call then returns `401`).
- Missing, malformed, or wrong token: `401 { "error": "Unauthorised" }`.

## Conventions

- **Versioning:** every success body starts with `"version": 1`. A breaking change will bump it; additive fields do not.
- **Ids:** `id` is the Notion page id (UUID, dashes optional) of a content item or proposal, and is what goes in the URL path. A malformed id is `400`; a well-formed id that does not exist is `404`.
- **Errors** are always `{ "error": "<message>" }` with one of:

| Status | Meaning |
|---|---|
| `400` | Bad input: invalid JSON, missing/blank field, unknown platform or status, malformed id, page not in a configured content DB, IG item sent to publish-next |
| `401` | Missing/wrong bearer token |
| `404` | Page / proposal id does not exist |
| `405` | Wrong HTTP method (`Allow` header lists the right one) |
| `409` | Conflict: the item has already moved on (e.g. editing a non-Draft, publishing a non-Approved item). See "Idempotency" for when this becomes a `200 noop` instead |
| `500` | Unexpected server or Notion failure (message included; safe to retry reads) |

- **Platforms:** `x`, `linkedin`, `substack` (underscores accepted, e.g. `ig_story`, but the IG lanes are currently hidden from the app).
- **Item lifecycle:** `Draft` → (`approve`) `Approved` → (publisher cron or `publish-next`) `Queued` → `Posted`. `Draft` → (`reject`) `Rejected`. IG-style items stay `Approved` until someone calls `mark-posted`.
- **Calibration:** approve / reject / edit decisions made through this API are recorded as Calibration Events with `source: "agent"`. An `edit`, and a `reject` that includes a `reason`, also create a *pending* amendment under `/proposals` for the human to review.

## Idempotency and replay

Retrying a request after a timeout is safe. State is re-read from Notion before every write, so the same call never double-applies.

| Action | If the item already moved on (409 from the core action) |
|---|---|
| `approve`, `reject` | **`200 { "noop": true, "note": "already-decided", "status": "<current status>" }`**, any non-Draft status (the `/api/hermes/decisions` convention). Always compare `status` with what you wanted: approving an item that is `Rejected` returns `200 noop` with `status: "Rejected"` and does **not** approve it. |
| `mark-posted` | `200 noop` (`note: "already-posted"`) only if the item is already `Posted`; any other non-Approved status is a real `409`. |
| `publish-next` | `200 noop` (`note: "already-queued"` / `"already-posted"`) if the item is already `Queued` / `Posted`; a Draft/Rejected item is a real `409`. No second Typefully draft is ever created. |
| `edit` | **Never converted to a no-op.** If the item is no longer a Draft the edit did not apply, so you get the `409`. Re-sending the same text while it is still a Draft is harmless. |
| proposals `accept` / `reject` | `200 noop` (`note: "already-accepted"` / `"already-rejected"`) if already in the requested status; a proposal in any other non-pending status is a real `409`. |
| `POST /drafts` | **Not idempotent.** Each successful call creates a new Draft. Do not blindly retry after a timeout; check `GET /drafts` first. |

## Endpoints

### `GET /api/agent/state`

One-call overview. Read-only. Lanes degrade independently: a failing lane is empty/zero and explained in `warnings` instead of failing the call.

```json
{
  "version": 1,
  "generatedAt": "2026-10-05T04:12:09.331Z",
  "drafts": [
    {
      "id": "3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42",
      "platform": "x",
      "title": "Shipping beats polishing",
      "body": "Most teams don't have a quality problem. They have a shipping-frequency problem.",
      "createdAt": "2026-10-05T01:30:00.000Z"
    }
  ],
  "lanes": {
    "approved": [
      { "id": "c91d...", "platform": "linkedin", "title": "Hiring for judgment", "status": "Approved", "scheduledAt": null, "updatedAt": "2026-10-04T22:10:00.000Z" }
    ],
    "queued": [
      { "id": "7be2...", "platform": "x", "title": "On defaults", "status": "Queued", "scheduledAt": "2026-10-06T01:00:00.000Z", "updatedAt": "2026-10-05T00:02:00.000Z" }
    ],
    "posted": [
      { "id": "e04a...", "platform": "x", "title": "Small teams", "status": "Posted", "scheduledAt": "2026-10-04T01:00:00.000Z", "updatedAt": "2026-10-04T01:03:00.000Z" }
    ],
    "manual": [],
    "rejected": [
      { "id": "5d8c...", "platform": "linkedin", "title": "Hot take", "status": "Rejected", "scheduledAt": null, "updatedAt": "2026-10-03T09:00:00.000Z" }
    ]
  },
  "publisher": { "mode": "typefully", "autoPlatforms": ["x", "linkedin"], "failures24h": 0 },
  "proposals": { "pending": 2 },
  "warnings": []
}
```

Notes: `drafts` = all pending-review drafts (up to 100, newest first, full bodies). `approved` / `queued` return up to 20 each, `posted` / `rejected` the latest 10, so these are summaries, not full history. `manual` = Approved items that are posted by hand. For `posted` items `updatedAt` is the closest available proxy for the post time. `publisher.mode` is `typefully` (auto-scheduling live) or `manual`. `proposals.pending` is capped at 100.

### `GET /api/agent/drafts`

Pending-review drafts with full bodies, newest first.

```json
{
  "version": 1,
  "drafts": [
    {
      "id": "3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42",
      "platform": "x",
      "title": "Shipping beats polishing",
      "body": "Most teams don't have a quality problem. They have a shipping-frequency problem.\n\nFix the cadence first.",
      "humanizer": "passed",
      "createdBy": "agent",
      "createdAt": "2026-10-05T01:30:00.000Z"
    }
  ],
  "warnings": []
}
```

`humanizer` / `createdBy` are provenance tags and may be `""` for drafts made by hand or before provenance existed.

### `POST /api/agent/drafts`

Create a draft. It always lands as `Status: Draft` in the approval queue and is **never published** by this call. Same validation as the Hermes draft bridge.

Request:

```json
{
  "platform": "linkedin",
  "title": "Hiring for judgment",
  "body": "The best hires I've made could tell me what NOT to build.\n\nHere is how I screen for it.",
  "sourceWorkflow": "weekly-ideas",
  "humanizerStatus": "passed"
}
```

Required: `platform`, `title`, `body` (max 20,000 characters). Optional: `sourcePositionIds` (string array), `sourceWorkflow` (string), `humanizerStatus` (`passed` | `failed` | `unknown`, default `unknown`). `createdBy` is always recorded as `"agent"` on this lane.

Response `201`:

```json
{
  "version": 1,
  "id": "c91d6a30-4f2b-4e8a-b7d3-0a9e1f5c2b68",
  "url": "https://www.notion.so/c91d6a304f2b4e8ab7d30a9e1f5c2b68",
  "platform": "linkedin",
  "status": "Draft",
  "warnings": []
}
```

Errors: `400` (unknown platform, missing title/body, body too long, invalid JSON).

### `POST /api/agent/items/{id}/approve`

Draft → Approved. No body. Does **not** publish; an Approved item is picked up by the publisher cron (or by an explicit `publish-next`).

```json
{
  "version": 1,
  "ok": true,
  "id": "3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42",
  "action": "approve",
  "noop": false,
  "status": "Approved",
  "item": { "id": "3a1f0c52-...", "platform": "x", "title": "Shipping beats polishing", "status": "Approved", "approvedAt": "2026-10-05T04:15:00.000Z", "editedBeforeApproval": false, "...": "full ContentItem" }
}
```

Replay (item already decided): `200 { "version": 1, "ok": true, "id": "...", "action": "approve", "status": "Approved", "noop": true, "note": "already-decided" }`. Errors: `400`, `404`.

### `POST /api/agent/items/{id}/reject`

Draft → Rejected. Optional body `{ "reason": "<text>" }`. A non-empty reason is stored on the Calibration Event and spawns a pending amendment for the human to classify; it is never auto-applied.

Request: `{ "reason": "Too promotional for my voice." }`

```json
{ "version": 1, "ok": true, "id": "3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42", "action": "reject", "noop": false, "status": "Rejected" }
```

Replay: `200 ... "noop": true, "note": "already-decided", "status": "<current>"`.

### `POST /api/agent/items/{id}/edit`

Replace a Draft's body. The item **stays a Draft**; approve it separately. The edit is recorded (original text snapshotted) and spawns a pending voice amendment.

Request: `{ "text": "Most teams don't have a quality problem. They have a cadence problem." }`

```json
{ "version": 1, "ok": true, "id": "3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42", "action": "edit", "noop": false, "status": "Draft", "body": "Most teams don't have a quality problem. They have a cadence problem." }
```

Errors: `400` (invalid JSON, `text` missing or blank), `409` (item is no longer a Draft).

### `POST /api/agent/items/{id}/mark-posted`

Approved → Posted, for items posted by hand (the manual lane). No body. Does not post anything itself.

```json
{ "version": 1, "ok": true, "id": "9f2e...", "action": "mark-posted", "noop": false, "status": "Posted" }
```

Errors: `409` (not Approved, and not already Posted).

### `POST /api/agent/items/{id}/publish-next`

Push one **already-Approved** auto-publish item into the next free Typefully slot now. No body. Only `Approved` items qualify, so a Draft cannot be published this way. IG items are posted manually (`400`).

```json
{ "version": 1, "ok": true, "id": "c91d6a30-...", "action": "publish-next", "noop": false, "status": "Queued", "slot": "2026-10-06T01:00:00.000Z", "typefullyId": "tf_8841233" }
```

Replay (already queued/posted): `200 ... "noop": true, "note": "already-queued", "status": "Queued"`. Errors: `400` (IG item / not a content page), `409` (not Approved, or has a Typefully id but is not Queued), `500` (Typefully/Notion failure; the item stays Approved and can be retried).

### `GET /api/agent/kpis?window=7|28`

The KPI payload the dashboard uses (anything other than `28` means 7).

```json
{
  "version": 1,
  "windowDays": 7,
  "overall": {
    "decisions": 14, "untouchedApprovalRate": 0.64, "editRate": 0.21, "rejectionRate": 0.15,
    "draftsProduced": 18, "draftsPerWeek": 18, "medianTimeToApprovalHours": 3.2, "publishFailures": 0
  },
  "perPlatform": { "X": { "decisions": 9, "untouchedApprovalRate": 0.67, "editRate": 0.22, "rejectionRate": 0.11 } },
  "dailyDecisions": [1, 3, 2, 0, 4, 2, 2],
  "dailyApprovals": [1, 2, 2, 0, 3, 1, 2]
}
```

Rates are `null` when there were no decisions.

### `GET /api/agent/proposals?status=pending&limit=20`

Identity-calibration proposals / amendments. `status` is one of `pending`, `accepted`, `rejected`, `applied` (unknown value is `400`; omit for all). `limit` max 100, default 20. Newest first.

```json
{
  "version": 1,
  "proposals": [
    {
      "id": "b7a40d19-2c5e-4f81-a3d6-91e0c8f2d577",
      "createdAt": "2026-10-04T12:00:00.000Z",
      "updatedAt": "2026-10-04T12:00:00.000Z",
      "sourceEventIds": ["1d9c..."],
      "topic": "Shipping beats polishing",
      "proposedPositionText": "Cut intros; lead with the claim.",
      "reason": "auto-generated from a draft edit — classify/edit before accepting",
      "evidenceSummary": "Draft edit on x\nBEFORE: ...\nAFTER: ...",
      "confidence": "low",
      "status": "pending",
      "targetType": "voice",
      "targetRef": "x"
    }
  ]
}
```

(Fields shown are abridged; the full object also has `affectedPositionId` and `currentPositionText`.)

### `POST /api/agent/proposals/{id}/accept` and `/reject`

Flip a **pending** proposal to `accepted` / `rejected`. No body.

```json
{ "version": 1, "ok": true, "id": "b7a40d19-2c5e-4f81-a3d6-91e0c8f2d577", "action": "accept", "status": "accepted", "noop": false, "proposal": { "...": "updated proposal" } }
```

`accepted` only marks the proposal. It **never** changes the Positions Library, voice, constitution, or twin repo; applying an amendment stays a manual human step. Errors: `400`, `404`, `409` (proposal is not pending and not already in the requested status).

## Worked examples (curl)

Set the base URL and token once (never paste the real token into logs or shared transcripts):

```bash
BASE=https://isaac-twin-command-center.vercel.app
AUTH="Authorization: Bearer $AGENT_API_TOKEN"
```

**1. List pending drafts**

```bash
curl -s -H "$AUTH" "$BASE/api/agent/drafts"
# => {"version":1,"drafts":[{"id":"3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42","platform":"x","title":"Shipping beats polishing", ...}],"warnings":[]}
```

**2. Approve one** (use an `id` from step 1)

```bash
curl -s -X POST -H "$AUTH" "$BASE/api/agent/items/3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42/approve"
# => {"version":1,"ok":true,"id":"3a1f0c52-...","action":"approve","noop":false,"status":"Approved","item":{...}}
# Run it again and you get: ..."noop":true,"note":"already-decided","status":"Approved"
```

**3. Check the state**

```bash
curl -s -H "$AUTH" "$BASE/api/agent/state" | jq '{pending: (.drafts | length), approved: (.lanes.approved | map(.id)), publisher}'
# => {"pending":0,"approved":["3a1f0c52-8b7e-4d19-9f66-2c0b5e7d1a42"],"publisher":{"mode":"typefully","autoPlatforms":["x","linkedin"],"failures24h":0}}
```

Optional: reject with a reason, or edit first:

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"text":"Tighter version of the post."}' "$BASE/api/agent/items/<id>/edit"
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"reason":"Off-voice, too salesy."}' "$BASE/api/agent/items/<id>/reject"
```

## What this API will NOT do

- **Nothing publishes without a prior explicit approve.** There is no endpoint that goes Draft → Queued/Posted in one step. `publish-next` only accepts `Approved` items (a Draft returns `409`), and `POST /drafts` only ever creates `Draft`s. Approved items are scheduled to Typefully by the publisher cron or by an explicit `publish-next`.
- **Amendments never auto-apply.** Edits and reject reasons create *pending* proposals; `accept` only flips a status flag. Nothing here writes to the Positions Library, voice, constitution, or twin files.
- It cannot delete or archive content, unqueue a Typefully draft, change settings or tokens, or read secrets. The state/KPI payloads contain no credentials.
- Treat `approve` as a real decision: it is a visible status change in the app, but the publisher will then schedule that item.

## Operator notes

- Enable: set `AGENT_API_TOKEN` on the server (Vercel env) and hand the same value to the agent. Revoke: unset or rotate it.
- Before the first deploy, run `npm run migrate` once so the Calibration Events `Source` select has the `agent` option (idempotent, additive).
- Smoke test: `npm run verify:agent-api` (keyless) and `npm run verify:agent-api -- --live` (see `scripts/verify-agent-api.ts`).
