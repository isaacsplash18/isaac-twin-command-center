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
