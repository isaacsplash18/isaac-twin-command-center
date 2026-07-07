# Hermes Calibration Plan — Isaac Twin Command Center

*Phases 0–2 of the build brief (`claude-code-twin-build-instructions.md`). This file is the
canonical architecture brief for every implementation phase. Written by the orchestrator,
who also built this repo — Phase 0/1 inspection is first-hand knowledge, not archaeology.*

---

## 1. Current architecture summary

**Repo:** `/Users/isaacho/AI Twin Command Center` — the deployed Command Center
(`https://isaac-twin-command-center.vercel.app`, Vercel project
`isaac-hos-projects/isaac-twin-command-center`).

**Stack:** Next.js 15 (App Router) + TypeScript + Tailwind 4 + Framer Motion. npm.
No app database — **Notion is the only store** (official API, pinned
`Notion-Version: 2025-09-03`, the data-sources era). Raw `fetch` client in
`lib/notion.ts`; no `@notionhq/client` dependency.

**Auth model (three lanes):**
- Human: passphrase → HMAC session cookie (`lib/auth.ts`), enforced by `middleware.ts`
  on everything except `/login`, `/api/auth/login`, `/api/cron/*`.
- Cron: `Authorization: Bearer ${CRON_SECRET}` (Vercel cron sends it).
- Machine (Hermes) — **does not exist yet**; this plan adds `HERMES_API_TOKEN` (lane 3).

**Key modules:**

| File | Role |
|---|---|
| `lib/notion.ts` | Notion client: `queryDataSource`, `updatePage`, `notionFetch`, block round-trip, `logEvent` (Pipeline Events), schema cache, property readers/writers |
| `lib/config.ts` | Platform registry (x / linkedin / ig-story / ig-carousel → env DS ids, body conventions), `requiredEnv` |
| `lib/items.ts` | `ContentItem` shaping, status-filtered queries, `readItemBody` |
| `lib/actions.ts` | approve / reject / edit / mark-posted / unqueue (re-read before write; logs Pipeline Events) |
| `lib/calibration.ts` | Weekly Positions Survey: `readSurvey()` parses the survey page blocks; `submitAnswer()` writes the answer block + deterministically calibrates the linked Position (Confirm/Sharpen/Reject) |
| `lib/publisher.ts`, `lib/typefully.ts` | Publisher + reconciler cores. **Dormant** — no `TYPEFULLY_API_KEY` set ⇒ manual copy-paste mode. Crons registered (publish 07:00/17:00 SGT, reconcile hourly) but no-op in manual mode |
| `lib/kpis.ts` | KPIs computed from Pipeline Events |
| `scripts/migrate.ts` | **The persistence-migration pattern**: idempotent, strictly additive Notion schema changes + DB creation. Extend this; never hand-create DBs |
| `scripts/discover.ts` | Verifies data source ids resolve |
| `components/NovaStage.tsx` | Calibration card UI (CONFIRM/SHARPEN/REJECT/SUBMIT/LATER) |
| `components/ApprovalQueue.tsx` | Draft cards (APPROVE/REJECT/EDIT) |

**Existing API routes:** `/api/queue`, `/api/kpis`, `/api/panels`, `/api/calibration`,
`/api/calibration/answer`, `/api/items/[pageId]/{approve,reject,edit,mark-posted,unqueue,publish-next}`,
`/api/cron/{publish,reconcile}`, `/api/auth/{login,logout}`.

**Env vars (all in `.env`, mirrored to Vercel production):** `NOTION_TOKEN`,
`NOTION_VERSION`, `DS_X`, `DS_LINKEDIN`, `DS_IG_STORY`, `DS_IG_CAROUSEL`, `DS_POSITIONS`,
`DS_INBOX`, `DS_WIKI`, `DS_EVENTS`, `AUTH_SECRET`, `SESSION_SECRET`, `CRON_SECRET`,
(`TYPEFULLY_API_KEY`, `TYPEFULLY_SOCIAL_SET_ID` empty ⇒ manual mode).

**Run/build/test:** `npm run dev` / `npx next build` (must stay clean; it's the CI) /
`npm run discover` / `npm run migrate`. No test framework — the repo convention is
**verification scripts** under `scripts/` plus curl smoke tests; keep to that.

**Hermes side (reference clone, read-only, in scratchpad):** GitHub
`isaacsplash18/hermes-context` = `~/twin` on the Mac mini. Contains `soul.md`,
`constitution.md`, `.hermes.md`, `AGENTS.md`, `packs/{voice,positions,constitution-full}.md`,
`packs/workflows/`, `scripts/{pull_identity.sh,gate_draft.sh}`, `runbooks/hermes-twin-runtime.md`,
`inbox/`, `humanizer_check.py`. Hermes pulls this repo every 30 min. **This machine is not
the Mac mini** — Hermes-side deliverables are built here under `hermes/` and shipped via a
git branch on `hermes-context` (never pushed to main by us).

## 2. Current data model (Notion)

- 4 content DBs (X / LinkedIn / IG Story / IG Carousel): `Status`
  (Draft/Approved/Queued/Posted/Rejected select), `Typefully ID`, `Scheduled At`,
  `Approved At`, `Edited Before Approval`, `Original Draft` (all added by our migration).
  X + LinkedIn bodies in page content, title prop `Hook`; IG Story body in
  `IG Story Copy` prop; IG Carousel in `Caption` + `Slide Texts`.
- **Positions Library** (`DS_POSITIONS`): `Position` title, `Status`
  (Active/Needs validation/Retired), `Confidence` (Predicted/Confirmed/Contested),
  `Last validated` date. This is **canonical identity data — never auto-mutated** except
  by the existing, Isaac-approved survey-answer path in `lib/calibration.ts`.
- **Pipeline Events** (`DS_EVENTS`): KPI event log (Approved / Approved-with-edits /
  Rejected / Queued / Posted / Publish-failed). Keep as-is; KPIs depend on it.
- Weekly Positions Survey **page** (block-structured, parsed by `readSurvey`).

## 3. Missing pieces (gap analysis vs. the brief)

1. Rich, structured **CalibrationEvents** — Pipeline Events is KPI-grade (no rawUserText,
   no affectedPositionIds, no status lifecycle); calibration-card actions (CONFIRM /
   SHARPEN / REJECT / SUBMIT / LATER) and draft EDITs are not captured as events at all.
2. **PositionUpdateProposals** — nothing turns calibration signals into reviewable
   pending changes; `submitAnswer` calibrates confidence metadata directly but never
   proposes text changes.
3. **Machine-readable export** for Hermes (no machine auth lane).
4. **Hermes sync worker** (Mac-mini side).
5. **Draft creation bridge** (Hermes → approval queue).
6. **Telegram approval bridge** (design, then build).
7. Publisher status surfaced to machines (publishing itself exists, gated, dormant).
8. **Notion → twin repo exporter** (soul/constitution/packs).

## 4. Proposed v1 calibration architecture

**Persistence decision:** two new Notion databases under the Constitution hub
(page `3651fec9-ef83-811b-a9ec-f530474ec779`), created by extending `scripts/migrate.ts`
(idempotent, additive — the established pattern). No SQL, no KV: Notion stays the single
store, events/proposals stay human-inspectable in Notion itself, and the app stays
stateless. Trade-off accepted: Notion API latency and coarse querying — fine at
single-user volume.

### 4.1 DB: Calibration Events (`DS_CALIBRATION_EVENTS`)

| Property | Notion type | Notes |
|---|---|---|
| `Name` | title | `"{action} — {objectType} — {topic|objectId}"` |
| `Source` | select | `command_center`, `telegram`, `hermes` |
| `Object Type` | select | `draft`, `position`, `calibration_card`, `wiki_note` |
| `Object ID` | rich_text | Notion page id / block id |
| `Platform` | select | `x`, `linkedin`, `ig_story`, `ig_carousel`, `unknown` |
| `Topic` | rich_text | |
| `Action` | select | `approve`, `reject`, `edit`, `confirm`, `sharpen`, `submit`, `later` |
| `Raw User Text` | rich_text | Isaac's own words (verdict text, edit text, rejection reason) |
| `Previous Text` | rich_text | truncated snapshot |
| `New Text` | rich_text | truncated snapshot |
| `Affected Position IDs` | rich_text | comma-separated page ids (relation avoided: cross-DB relation ids aren't stable across data sources; keep it dumb) |
| `Inferred Delta` | rich_text | deterministic label only (e.g. `position-contested`) — **never fabricated inference** |
| `Status` | select | `pending`, `accepted`, `rejected`, `applied` |
| *(createdAt)* | — | Notion `created_time`, not a custom prop; expose as `createdAt` in TS/JSON |

TS type `CalibrationEvent` in new `lib/calibration-events.ts` with `logCalibrationEvent()`
(fire-and-forget safe, like `logEvent`) + `queryCalibrationEvents({since, limit})`.
**Dual-logging is intentional:** draft approve/reject/edit keep writing Pipeline Events
(KPIs) *and* now write CalibrationEvents (richer). Do not touch `lib/kpis.ts`.

Wiring points: `lib/actions.ts` (approve/reject/edit), `lib/calibration.ts` `submitAnswer`
(confirm/sharpen/reject verdict + submit), new `POST /api/calibration/later` for LATER
(currently client-side only; fire-and-forget from `NovaStage`). Inspection surface:
`GET /api/calibration-events?limit=50` (session-authed).

### 4.2 DB: Position Proposals (`DS_PROPOSALS`)

| Property | Notion type | Notes |
|---|---|---|
| `Name` | title | short topic line |
| `Source Event IDs` | rich_text | comma-separated |
| `Affected Position ID` | rich_text | |
| `Topic` | rich_text | |
| `Current Position Text` | rich_text | snapshot at proposal time |
| `Proposed Position Text` | rich_text | v1 = Isaac's own rawUserText, labelled as such |
| `Reason` | rich_text | |
| `Evidence Summary` | rich_text | deterministic: which events, when |
| `Confidence` | select | `low`, `medium`, `high` |
| `Status` | select | `pending`, `accepted`, `rejected`, `applied` |
| *(createdAt / updatedAt)* | — | Notion `created_time` / `last_edited_time` |

**Deterministic v1 generation (no LLM):** inline after event persistence —
- `sharpen` + non-empty rawUserText → proposal, confidence `medium`.
- `reject` (calibration verdict) + rawUserText → proposal (contested), confidence `low`.
- `confirm` → no proposal (already applied by the existing survey path).
- Idempotency: skip if a `pending` proposal already exists for the same
  `Affected Position ID` (query-before-create).
- If evidence is insufficient (no rawUserText, no linked position) → **no proposal**.
  Never guess.

**Accept/reject:** `POST /api/proposals/[id]/{accept,reject}` (session-authed) flips
`Status` only. **`accepted ≠ applied`** — applying to the canonical Positions Library /
twin repo stays manual for v1 (a later phase may add an explicit "apply" action; never
automatic). UI: "PROPOSED UPDATES" panel (right column, above Positions Library),
FrameCard style, topic + current→proposed + reason + ACCEPT/REJECT.

### 4.3 Machine lane: `HERMES_API_TOKEN`

New env var (generated at final gate, pushed to Vercel). Checked as
`Authorization: Bearer` by a small helper (`lib/machine-auth.ts`), constant-time compare
like `CRON_SECRET`. Add the new API paths to the middleware public list —
**they must self-authenticate** (document this clearly; middleware change is the one
shared-file edit phases must coordinate on).

- `GET /api/hermes/export?since=ISO` → `{ generatedAt, since, events[], proposals: { pending[], accepted[] }, drafts: { pendingReview: n }, publisher: { mode: "manual"|"typefully", failures24h } }` — stable ids + ISO timestamps, no secrets.
- `POST /api/drafts` → create pending draft (below).
- Docs in `docs/hermes-integration.md` with curl examples + `scripts/verify-hermes-export.ts`.

### 4.4 Draft creation bridge

`POST /api/drafts` (machine lane): body `{ platform, title, body, sourcePositionIds?,
sourceWorkflow?, humanizerStatus? }` → validated → page created in the right content DB
with `Status: Draft` (**our existing "pending review" state** — the approval queue picks
it up with zero UI changes), body written per-platform (page content vs props, existing
conventions), plus new **additive** props on all 4 content DBs (migration):
`Created By` (select: `agent`, `hermes`, `manual`), `Source Workflow` (rich_text),
`Humanizer` (select: `passed`, `failed`, `unknown`). Never publishes.

### 4.5 Hermes-side deliverables (built here, shipped via branch)

`hermes/` directory in this repo, mirroring twin-repo layout:
- `hermes/scripts/sync_command_center_calibration.py` — Python 3 stdlib only (the Mac
  mini runs plain python3; no pip deps). Fetches export, validates schema, writes
  `inbox/calibration/YYYY-MM-DD.md`, state file (`.calibration-sync-state.json`, last
  seen ids) so re-runs are idempotent and **silent when nothing changed** (exit 0, no
  output, no file rewrite). `--dry-run` prints instead of writing. Env:
  `COMMAND_CENTER_URL`, `HERMES_API_TOKEN` (documented in `hermes/.env.example`).
- `hermes/runbooks/hermes-twin-runtime.md` **addition** (patch section to append).
- Phase 11 exporter: `scripts/export-twin-context.ts` (runs HERE, has NOTION_TOKEN;
  outputs to `hermes/export-preview/` in dry-run; discovery-based page ids — search the
  Constitution hub; if a source page can't be found, write a documented stub and STOP for
  that file, never invent).

Ship: branch `calibration-bridge` on `isaacsplash18/hermes-context`, files copied from
`hermes/`, PR-able. **Never push main; Hermes cron pulls main every 30 min, so main is
effectively production.**

### 4.6 Telegram bridge — design only (Phase 8)

`docs/telegram-approval-bridge.md`. Implementation explicitly **gated on Isaac's
approval** (his own brief: "Do not code until this design is approved"). The design must
reuse the existing Hermes Telegram gateway and write decisions back through
`POST /api/items/[pageId]/*` + CalibrationEvents.

## 5. Exact files to change, per phase

- **P3:** `lib/calibration-events.ts` (new), `lib/actions.ts`, `lib/calibration.ts`,
  `app/api/calibration/later/route.ts` (new), `app/api/calibration-events/route.ts` (new),
  `components/NovaStage.tsx` (LATER ping only), `scripts/migrate.ts` (+DB), `.env.example`,
  `scripts/verify-calibration-events.ts` (new), this doc (§9 changelog).
- **P4:** `lib/proposals.ts` (new), `lib/calibration-events.ts` (hook), 
  `app/api/proposals/route.ts` + `app/api/proposals/[id]/{accept,reject}/route.ts` (new),
  `components/ProposalsPanel.tsx` (new), `components/CommandCenter.tsx` (mount panel),
  `scripts/migrate.ts` (+DB), `scripts/verify-proposals.ts`, `.env.example`.
- **P5:** `lib/machine-auth.ts` (new), `app/api/hermes/export/route.ts` (new),
  `middleware.ts` (public-list addition), `docs/hermes-integration.md` (new),
  `scripts/verify-hermes-export.ts` (new), `.env.example`.
- **P6:** `hermes/scripts/sync_command_center_calibration.py`, `hermes/.env.example`,
  `hermes/runbooks/hermes-twin-runtime.md`, `hermes/README.md` (all new; no app code).
- **P7:** `app/api/drafts/route.ts` (new), `lib/items.ts` (create helper),
  `scripts/migrate.ts` (+props), `docs/hermes-integration.md` (extend),
  `scripts/verify-draft-bridge.ts`.
- **P8:** `docs/telegram-approval-bridge.md` (new; docs only).
- **P10:** `docs/hermes-integration.md` publisher section; export already carries status.
- **P11:** `scripts/export-twin-context.ts` (new), `hermes/export-preview/` (gitignored
  or committed as preview — committed, it's not secret), runbook addition.

## 6. Verification plan

Every phase: `npx next build` green + a `scripts/verify-*.ts` (or curl block in docs)
exercising the new surface against `npm run dev` locally, using test entities that are
**created then archived** (Notion pages support `archived: true` cleanup) — never touch
real drafts/positions. Orchestrator gates each phase: reviews diff, runs build +
verification, runs migrations (agents must **never** run `npm run migrate` — they only
extend the script), commits.

## 7. Rollback plan

- Code: one commit per phase → `git revert <sha>`.
- Notion: all schema changes additive; new DBs can be archived in Notion UI; new props
  ignored by other agents (they match by name).
- Env: removing `HERMES_API_TOKEN` from Vercel disables the whole machine lane (export,
  drafts bridge) in one move.
- Hermes side: deliverables live on a non-main branch; rollback = delete branch.

## 8. Constraints for sub-agents (read this, then your phase prompt)

1. Persistence = Notion via `lib/notion.ts` helpers + `scripts/migrate.ts` extension.
   No new databases/ORMs/KV. Follow existing code style (British dates, mono statuses,
   FrameCard UI, `handleAction` route helper pattern).
2. **Do not run** `npm run migrate`, git commits, or deploys — orchestrator does, at gates.
3. Do not start dev servers on port 3000 (may be occupied); build with `npx next build`
   only when your phase prompt says you own the build.
4. Guardrails from the brief apply verbatim: no publishing, no canonical-identity
   mutation, no secrets in code, no invented credentials/IDs, small reversible changes,
   docs + verification for everything, stop and ask if a schema is ambiguous.
5. `accepted` proposals must not mutate Positions Library, the survey page, or the twin
   repo. `applied` is reserved for a future explicit action.

## 9. Phase changelog

*(appended by each phase)*

### Phase 3 — Persist Calibration Events

**Files changed:**

- `lib/calibration-events.ts` (new) — `CalibrationEvent` type + `CalibrationSource` /
  `CalibrationObjectType` / `CalibrationPlatform` / `CalibrationAction` / `CalibrationStatus`
  unions; `logCalibrationEvent()` (fire-and-forget safe: warns + returns `null` if
  `DS_CALIBRATION_EVENTS` is unset, catches and warns on any Notion error, never throws);
  `queryCalibrationEvents({ sinceIso?, limit? })` (newest-first, maps Notion props back to
  the interface, `[]` when unconfigured).
- `scripts/migrate.ts` — added `ensureCalibrationEventsDb()` (search-first idempotent
  create, same pattern as `ensureEventsDb`), wired into `main()`. Prints
  `DS_CALIBRATION_EVENTS=<id>` when found/created. **Not run by this phase** — the
  orchestrator runs `npm run migrate`.
- `lib/actions.ts` — added `calibrationPlatform()` helper (maps `"ig-story"` →
  `"ig_story"` etc.); `approveItem`/`rejectItem`/`editItem` each now also call
  `logCalibrationEvent` (dual-logging alongside the existing `logEvent` Pipeline Events
  call, which is untouched) with actions `approve` / `reject` / `edit` respectively,
  `objectType: "draft"`, `objectId: pageId`, `topic` = the item's title.
- `lib/calibration.ts` — `submitAnswer()` now logs exactly one CalibrationEvent per call:
  `action` = the verdict lowercased (`confirm`/`sharpen`/`reject`) when given, else
  `submit`; `objectType: "calibration_card"`, `objectId: answerBlockId`, `rawUserText` =
  the answer text, `affectedPositionIds` = `[positionPageId]` when present,
  `inferredDelta` = one of `position-confirmed` / `position-sharpened` /
  `position-contested` / `answer-recorded` (deterministic label only, never fabricated),
  `status` = `accepted` for `confirm` (already applied by the existing calibration write),
  else `pending`.
- `app/api/calibration/later/route.ts` (new) — `POST { objectId, topic? }`, session-authed
  via the existing middleware (no allowlist change), logs action `later` /
  `objectType: "calibration_card"` / `status: "pending"`. Uses the `handleAction` pattern.
- `app/api/calibration-events/route.ts` (new) — `GET ?limit=&since=`, session-authed,
  returns `{ events: CalibrationEvent[] }`. Same error-handling shape as `/api/queue`.
- `components/NovaStage.tsx` — `skip()` now also fires-and-forgets a
  `POST /api/calibration/later` with `{ objectId: answerBlockId, topic: question title }`
  before rotating the question to the back of the queue. No other UI change.
- `.env.example` — added `DS_CALIBRATION_EVENTS=` with a comment.
- `scripts/verify-calibration-events.ts` (new) — if `DS_CALIBRATION_EVENTS` is unset,
  prints a "run migration first" message and exits 0; otherwise creates one throwaway
  event, reads it back, asserts a field-by-field round-trip, then archives the test page.
- `package.json` — added `verify:calibration-events` script.
- this doc (§9, this section).

**New env vars:** `DS_CALIBRATION_EVENTS` (created by `npm run migrate`; the app degrades
gracefully — logs a warning and no-ops — while it's unset).

**How to verify:**

1. Orchestrator runs `npm run migrate` (extends the script; this phase never ran it) and
   pastes the printed `DS_CALIBRATION_EVENTS` into `.env` / Vercel.
2. `npm run verify:calibration-events` — creates, reads back, asserts, archives a
   throwaway test event; prints PASS/FAIL per assertion.
3. `npx next build` stays green (verified this phase — clean build, both new routes
   present: `/api/calibration-events`, `/api/calibration/later`).
4. Manual smoke test against `npm run dev`: approve/reject/edit a draft, submit a
   calibration answer with/without a verdict, tap LATER on a question — then
   `GET /api/calibration-events?limit=20` (with the session cookie) should show one new
   event per action, with `rawUserText`/`previousText`/`newText` populated as applicable.

**Limitations:**

- LATER logs on every tap, including repeated taps on the same question within a session
  (no de-dup) — by design, so the frequency itself is a signal.
- Draft approve/reject/edit events carry `affectedPositionIds: []` — drafts aren't linked
  to Positions in this data model yet.
- `submitAnswer`'s CalibrationEvent has no `topic` (the survey's `submitAnswer` signature
  doesn't carry the question title) — its `Name` falls back to `objectId` (the answer
  block id). LATER events do carry `topic` since `NovaStage` has the question title
  in hand.
- `logCalibrationEvent` truncates long fields to ~1900 chars before storing — full-length
  originals are not preserved if a draft body or answer exceeds that.
- No relation property to Positions Library (deliberate — cross-DB relation ids aren't
  stable across data sources per §4.1); `Affected Position IDs` is a comma-separated
  rich-text list, parsed back into `string[]` by `queryCalibrationEvents`.

**Rollback:** `git revert` this phase's commit (removes all code changes; the
`later`/`calibration-events` routes and dual-logging calls disappear, and `submitAnswer`/
`approveItem`/`rejectItem`/`editItem` go back to Pipeline-Events-only). In Notion, archive
the "Calibration Events" database from the UI — it's additive and nothing else depends on
it. Unset `DS_CALIBRATION_EVENTS` to make the app treat it as not-yet-migrated again
(logging becomes a no-op warning, same as before this phase).

### Phase 4 — Pending Position Update Proposals

**Files changed:**

- `lib/proposals.ts` (new) — `PositionUpdateProposal` interface (§4.2: `id`,
  `createdAt`/`updatedAt` from Notion `created_time`/`last_edited_time`, `sourceEventIds`,
  `affectedPositionId`, `topic`, `currentPositionText`, `proposedPositionText`, `reason`,
  `evidenceSummary`, `confidence`, `status`) + `ProposalConfidence`/`ProposalStatus` unions.
  - `maybeCreateProposalFromEvent(event)` — deterministic v1 generator (no LLM). Only fires
    for `sharpen` (confidence `medium`) and `reject`-verdict (confidence `low`) calibration
    events, and only when `rawUserText` is non-empty AND `affectedPositionIds` has ≥1 id;
    otherwise returns `null` (never guesses). Idempotency: query-before-create — if a
    `pending` proposal already exists for the same `Affected Position ID`, returns `null`
    (no duplicate, no merge in v1). `currentPositionText` = a read-only snapshot of the
    Position page (title via `readTitle`, plus optional `Nuance`/`Basis` rich_text read
    defensively — absent props tolerated). `proposedPositionText` = the event's `rawUserText`
    verbatim; the framing lives in `Reason` (`Isaac's own words from a SHARPEN verdict on the
    weekly survey` / `REJECT verdict — position contested`). `evidenceSummary` = deterministic
    `{action} · event {id} · {ISO date}`. Status `pending`. Fire-and-forget safe: warns +
    returns `null` when `DS_PROPOSALS` unset, never throws.
  - `queryProposals({ status?, limit? })` — newest-first, `[]` when unconfigured.
  - `getProposal(id)` — single re-read (for the route guard).
  - `setProposalStatus(id, "accepted" | "rejected")` — flips the `Status` select only.
    Deliberately touches nothing canonical (Positions Library / survey page / twin repo) —
    §8 rule 5: `accepted ≠ applied`.
- `lib/calibration.ts` — `submitAnswer()` now captures the `CalibrationEvent` returned by
  `logCalibrationEvent` and calls `maybeCreateProposalFromEvent(event)` right after (the only
  v1 source of sharpen/reject-with-position events). Draft approve/reject/edit are NOT wired
  (no linked positions there — Phase 3 limitation).
- `app/api/proposals/route.ts` (new) — `GET ?status=&limit=`, session-authed via middleware,
  returns `{ proposals: [...] }`.
- `app/api/proposals/[id]/accept/route.ts` + `.../reject/route.ts` (new) — `handleAction`
  pattern; re-read before write and **409 if the proposal is not currently `pending`** (same
  discipline as `lib/actions.ts`); return the updated proposal.
- `components/ProposalsPanel.tsx` (new) — `PROPOSED UPDATES` FrameCard, mounted in
  `components/CommandCenter.tsx` right column ABOVE `PositionsPanel` (index 3; Positions/
  Inputs/Automations bumped to 4/5/6). Per proposal: topic + confidence chip (oxbright/amber/
  phosphor for low/medium/high), CURRENT→PROPOSED (font-serif; current `text-ink-dim`, proposed
  `text-ink`), reason, ACCEPT/REJECT MiniBtns. Optimistic remove with restore-on-error + toast
  via `onError`. Fetches `useApi("/api/proposals?status=pending", 120_000)`. Renders `null`
  when there are no pending proposals (panel disappears). Accept toast text is exactly
  `ACCEPTED — APPLY TO NOTION MANUALLY (NOT AUTO-APPLIED)`.
- `scripts/migrate.ts` — added `ensurePositionProposalsDb()` (search-first idempotent create,
  same pattern as `ensureCalibrationEventsDb`); prints `DS_PROPOSALS=<id>`. Wired into `main()`.
  **Not run by this phase.**
- `.env.example` — added `DS_PROPOSALS=` with the migration comment.
- `scripts/verify-proposals.ts` (new) + `package.json` `verify:proposals` script — exits 0
  with a "run migration first" message when `DS_PROPOSALS` unset; otherwise runs the generator
  negative gates in memory (confirm / empty text / no position → `null`) plus a `DS_PROPOSALS`
  round-trip on a directly-created proposal page (query → accept → re-read → archive). Optional
  `--position-id <id>` adds an end-to-end generation + idempotency check against a real
  position, archiving what it creates.
- this doc (§9, this section).

**New env vars:** `DS_PROPOSALS` (created by `npm run migrate`; app degrades gracefully —
generation and queries no-op — while unset).

**How to verify:**

1. Orchestrator runs `npm run migrate` and pastes the printed `DS_PROPOSALS` into `.env` /
   Vercel.
2. `npm run verify:proposals` (optionally `-- --position-id <id>`) — prints PASS/FAIL per
   assertion; creates and archives only throwaway pages.
3. `npx next build` stays green (verified this phase — clean build; routes present:
   `/api/proposals`, `/api/proposals/[id]/accept`, `/api/proposals/[id]/reject`).
4. Manual smoke test against `npm run dev`: submit a calibration answer with a SHARPEN or
   REJECT verdict on a question that has a linked Position → a pending proposal appears in the
   PROPOSED UPDATES panel; ACCEPT shows the manual-apply toast and removes it; the Positions
   Library is unchanged (accept is status-flip only).

**Limitations:**

- No dedup/merge of multiple events into one proposal. Idempotency is a hard skip: if a pending
  proposal already exists for a position, later sharpen/reject verdicts on it generate nothing
  (the newest signal is silently dropped until the existing one is accepted/rejected).
- Only survey-sourced calibration events (`submitAnswer`) generate proposals. Draft approve/
  reject/edit carry no linked positions, so they never produce proposals.
- `accepted ≠ applied`: accepting flips `Status` only. Writing the proposed text back to the
  canonical Positions Library / twin repo stays manual for v1 (a future explicit "apply" action
  may automate it — never automatic).
- `currentPositionText` is a best-effort snapshot; if the Position page can't be read it stores
  a `(could not read position …)` marker rather than inventing text.
- Proposal `Topic`/`Name` fall back to the Position title then the position id, since
  `submitAnswer`'s CalibrationEvent has no `topic` (Phase 3 limitation).

**Rollback:** `git revert` this phase's commit (removes `lib/proposals.ts`, the proposals
routes, the panel, the `submitAnswer` generation call, and the migration/env additions). In
Notion, archive the "Position Proposals" database from the UI — it's additive and nothing else
depends on it. Unset `DS_PROPOSALS` to make the app treat it as not-yet-migrated (generation and
queries no-op, same as before this phase). No canonical data is ever touched by this phase, so
there is nothing to un-apply.

### Phase 5 — Hermes-Readable Export

**Files changed:**

- `lib/machine-auth.ts` (new) — `isMachineAuthorized(req: NextRequest): boolean`. Compares
  `Authorization: Bearer ${HERMES_API_TOKEN}` using `timingSafeEqualStr` (re-exported from
  `lib/auth.ts` rather than duplicated). Returns `false` whenever `HERMES_API_TOKEN` is unset —
  the machine lane is disabled by default, matching the `CRON_SECRET` convention. Never logs the
  token or the incoming header.
- `lib/auth.ts` — `timingSafeEqualStr` changed from a private function to `export function` so
  `lib/machine-auth.ts` can reuse it instead of duplicating the constant-time compare. No
  behaviour change to the existing passphrase check.
- `lib/config.ts` — `TYPEFULLY_ENABLED` changed from a private `const` to `export const` so the
  export route can derive `publisher.mode` the exact same way `PLATFORMS` does, without
  duplicating the `!!process.env.TYPEFULLY_API_KEY && process.env.PUBLISH_MODE !== "manual"`
  logic (and without ever exporting the key itself).
- `app/api/hermes/export/route.ts` (new) — `GET` only, `dynamic = "force-dynamic"`. Auth via
  `isMachineAuthorized` → `401 {"error":"Unauthorised"}` otherwise. Query params: `since` (ISO,
  defaults to 7 days ago; invalid values silently fall back to the default), `limit` (default
  100, clamped to 200, applies only to `events`). Response: `{ version: 1, generatedAt, since,
  events, proposals: { pending, accepted }, drafts: { pendingReview }, publisher: { mode },
  warnings }`. Each lane degrades independently and gracefully: unset `DS_CALIBRATION_EVENTS` /
  `DS_PROPOSALS` / a content platform's `DS_*` env var yields an empty array/zero count for that
  lane plus a named entry in the always-present `warnings: string[]` array (never a hard
  failure). `drafts.pendingReview` sums `Status: Draft` counts across the 4 content DBs
  (X/LinkedIn/IG Story/IG Carousel) via `itemsWithStatus`, tolerating the same
  not-yet-migrated-schema case `/api/queue` already tolerates. No secrets anywhere in the
  payload — `publisher.mode` is derived from `TYPEFULLY_ENABLED`, never the key itself.
- `middleware.ts` — added `/api/hermes/` to `PUBLIC_PREFIXES` alongside `/api/cron/`, with a
  comment explaining both prefixes self-authenticate (Bearer `CRON_SECRET` /
  `HERMES_API_TOKEN`) and are therefore exempt from the human session-cookie check. No other
  line in the file touched.
- `.env.example` — added `HERMES_API_TOKEN=` with a comment (generate command, and a note that
  leaving it empty disables the machine lane entirely).
- `docs/hermes-integration.md` (new) — purpose, auth model, full `GET /api/hermes/export`
  reference (params, annotated example response, field-by-field meaning — explicitly calling
  out that `proposals.accepted` is **not** canonical/applied), curl examples for both
  `http://localhost:3000` and the production URL, error codes table, versioning note.
- `scripts/verify-hermes-export.ts` (new) — if `HERMES_API_TOKEN` is unset, prints "machine lane
  disabled — set HERMES_API_TOKEN" and exits 0. Otherwise: asserts an unauthenticated request and
  a wrong-token request both get `401`; asserts an authenticated request gets `200`; structurally
  validates every top-level key, every `events[]`/`proposals.pending[]`/`proposals.accepted[]`
  entry's field types, that all timestamps parse, that `events` is sorted newest-first, and that
  no key anywhere in the payload matches a token/secret/apikey/password-like pattern. PASS/FAIL
  per assertion, like the Phase 3/4 verify scripts.
- `package.json` — added `verify:hermes-export` script.
- this doc (§9, this section).

**New env vars:** `HERMES_API_TOKEN` (machine lane token; the export route — and, in a later
phase, the draft bridge — return `401` while it's unset, which is the safe default).

**How to verify:**

1. `npx next build` stays green (verified this phase — clean build; new route
   `/api/hermes/export` present in the route list, no route or type errors).
2. `npm run verify:hermes-export -- --url <base-url>` — prints "machine lane disabled" and exits
   0 if `HERMES_API_TOKEN` is unset; otherwise runs the auth + schema assertions above and prints
   PASS/FAIL per check. Exercised this phase against a **temporary** `PORT=3100 npx next dev`
   process with an inline (not persisted) test token — never against port 3000, never written to
   `.env`. All assertions passed, including a live pull of real Notion data (`drafts.pendingReview`
   reflected the real Draft count across the 4 content DBs; `events`/`proposals` were empty
   because no calibration events or proposals exist yet — `warnings` was `[]`, confirming
   `DS_CALIBRATION_EVENTS`/`DS_PROPOSALS` are already configured in `.env` from Phases 3–4). The
   temporary dev server was killed at the end of the smoke test.
3. Manual smoke test against a real deployment: set `HERMES_API_TOKEN` in Vercel, then
   `curl -H "Authorization: Bearer $HERMES_API_TOKEN"
   https://isaac-twin-command-center.vercel.app/api/hermes/export` should return `200` with the
   documented shape; the same request without the header should return `401`.

**Limitations:**

- `since` only filters `events`; `proposals.pending`/`proposals.accepted` are always the full
  lists (each capped at 100 by `queryProposals`) — no time-windowing or pagination for proposals
  yet, matching current single-user volume.
- `events` has a hard `limit` cap (max 200), not a pagination cursor — acceptable for now, would
  need revisiting if event volume grows much past that between Hermes sync runs.
- `drafts.pendingReview` is a count only, not draft content — reading actual draft bodies over
  the machine lane is intentionally out of scope until Phase 7 (and even then that phase is a
  one-way Hermes → Command Center *write*, not a read of existing drafts).
- No rate limiting on the endpoint, consistent with the rest of the app (single trusted caller
  expected).
- The route trusts `HERMES_API_TOKEN` as a single shared secret (no per-caller scoping/rotation
  scheme) — fine for a single Hermes worker, would need revisiting for multiple machine callers.

**Rollback:** `git revert` this phase's commit (removes `lib/machine-auth.ts`, the export route,
the middleware public-list line, the docs, and the verify script; reverts `timingSafeEqualStr`
and `TYPEFULLY_ENABLED` back to unexported — no other phase depends on those two exports yet, so
this is safe). Removing `HERMES_API_TOKEN` from Vercel/`.env` alone is enough to disable the
whole machine lane in one move without any code change — the route fails closed (`401`) whenever
it's unset. No canonical data is ever touched by this phase (GET-only, read-only), so there is
nothing to un-apply.

### Phases 6–8, 10, 11 (parallel batch)

Implemented by four parallel sub-agents plus the orchestrator (P10), gated
together. Full per-phase changelogs live in `docs/changelogs/phase-{6,7,8,10,11}.md`:

- **P6** — Hermes sync worker (`hermes/scripts/sync_command_center_calibration.py`,
  stdlib-only, idempotent/quiet, exit codes 0/2/3/4, fixture + dry-run modes).
- **P7** — Draft creation bridge (`POST /api/hermes/drafts`), additive provenance
  props (Created By / Source Workflow / Humanizer / Source Position IDs) migrated live.
- **P8** — Telegram approval bridge **design** (`docs/telegram-approval-bridge.md`);
  implementation (Phase 9) gated on Isaac approving the design. Six open questions inside.
- **P10** — Publisher gating verified against the brief; `publisher.failures24h`
  added to the export (additive, version 1); docs section in hermes-integration.md.
- **P11** — Notion→twin exporter (`scripts/export-twin-context.ts`, dry-run default,
  discovery-based, 7 real exports + 4 documented stubs in `hermes/export-preview/`).
