# Identity Calibration layer + review-UX upgrade

*Extends the Phase 4 PositionUpdateProposals system (`docs/hermes-calibration-plan.md`
§4.2) into a general **amendment** model spanning voice / constitution / positions /
workflows, and upgrades the Command Center draft-review UX. The Command Center is now the
only draft-review surface (the Telegram bridge is paused, but its machine-lane write-back
routes stay live and are reused by verification). Nothing here ever mutates a canonical
file — accepting an amendment only flips a status.*

## What changed (files)

**Data model / generation**

- `scripts/migrate.ts` — added `PROPOSAL_NEW_PROPS` (`Target Type` select, `Target Ref`
  rich_text) and an **additive property-patch pass** inside `ensurePositionProposalsDb()`:
  when the "Position Proposals" DB already exists it now PATCHes the two new props on
  (mirroring the content-DB `NEW_PROPS` pass) instead of only creating the DB. Fresh
  creates include the props too. Idempotent; never renames/removes anything. **Not run by
  this change — the orchestrator runs `npm run migrate` at the gate.**
- `lib/proposals.ts`
  - `PositionUpdateProposal` gained `targetType: ProposalTargetType` and `targetRef: string`.
    New `ProposalTargetType` union (`position | voice | constitution | workflow | unclassified`)
    and `PROPOSAL_TARGET_TYPES` export. Reader default: a row with **no** `Target Type` reads
    back as `position` (back-compat with all existing rows).
  - Extracted a shared `writeProposal()` that both generators use; it writes `Target Type` /
    `Target Ref` and **retries without them on a schema-mismatch** (pre-migration safe, same
    pattern as `lib/items.ts createDraft`).
  - `maybeCreateProposalFromEvent()` (survey sharpen/reject → position proposal) unchanged in
    behaviour; now routes through `writeProposal` with `targetType: "position"`.
  - **New** `maybeCreateAmendmentFromDraftEvent(event)`:
    - draft `edit` → `targetType: "voice"`, `targetRef: <platform>`, proposedText = new body,
      evidence = before/after excerpt, confidence `low`.
    - draft `reject` **with** a non-empty reason → `targetType: "unclassified"`,
      `targetRef: <platform>`, proposedText = the reason verbatim, evidence = draft title +
      platform, confidence `low`.
    - draft `reject` **with no** reason → `null` (no signal).
    - approve / non-draft → `null`.
    - Idempotency: query-before-create on `Source Event IDs contains <event id>` + pending.
    - Fire-and-forget safe: warns + returns `null` when `DS_PROPOSALS` unset; never throws.
  - **New** `updateProposal(id, { proposedText?, targetType?, targetRef? })` for the PATCH route.
- `lib/actions.ts` — `editItem` and `rejectItem` now capture the `CalibrationEvent` returned by
  `logCalibrationEvent` and call `maybeCreateAmendmentFromDraftEvent(event)` (non-fatal,
  after the status change has committed). `approveItem` unchanged (approve is not a signal).
  The hardened snapshot-before-body ordering and non-fatal `logEvent` handling are untouched.

**Reject-with-reason (web UI)**

- `app/api/items/[pageId]/reject/route.ts` — accepts an optional JSON body `{ reason?: string }`
  and passes it to `rejectItem(pageId, "command_center", reason)`. No body still rejects
  (backward compatible with the command palette).
- `components/ApprovalQueue.tsx` `DraftCard` — tapping REJECT now reveals a compact inline
  reason row (text input + **REJECT** confirm + **SKIP** = reject with no reason) instead of
  rejecting instantly. Enter confirms, Escape / focus-leaving-the-row cancels. 44px tap
  targets, mobile-first. Optimistic removal semantics unchanged.

**Edit UX upgrade**

- `components/ApprovalQueue.tsx` `DraftCard` — per-platform char counter (`X` hard 280, over
  in oxbright; `LinkedIn` soft 3000, over in amber; shown in view and edit), autosizing
  textarea (no fixed rows), and a **VS ORIGINAL** toggle that reveals the `Original Draft`
  snapshot — rendered only when the item has one.
- `lib/items.ts` + `components/types.ts` — `ContentItem` gained `originalDraft: string | null`
  (read from the existing `Original Draft` prop) to drive the toggle.

**Identity Calibration panel**

- `components/IdentityCalibrationPanel.tsx` (new) — replaces `components/ProposalsPanel.tsx`
  (deleted). Header "IDENTITY CALIBRATION"; four always-visible lanes VOICE / CONSTITUTION /
  POSITIONS / WORKFLOWS plus an UNCLASSIFIED inbox lane shown only when non-empty. Each
  amendment card shows target ref/topic, evidence, current→proposed, a confidence chip; EDIT
  edits the proposed text inline (PATCH), a small select reclassifies Target Type (PATCH),
  ACCEPT / REJECT decide it (44px). Standing note: "Accepted amendments are never
  auto-applied — canonical files change only when Isaac applies them." Empty state per lane:
  "No pending amendments."
- `components/CommandCenter.tsx` — mounts `IdentityCalibrationPanel` where `ProposalsPanel`
  sat (right column, `index={3}`, same mobile order).

**API**

- `app/api/proposals/[id]/route.ts` (new) — `PATCH { proposedText?, targetType?, targetRef? }`,
  session lane. 400 on bad types / invalid targetType / empty patch; **409 unless status is
  `pending`** (same discipline as accept/reject). Existing
  `POST /api/proposals/[id]/{accept,reject}` unchanged.
- `GET /api/hermes/export` — proposal serialization now carries `targetType` / `targetRef`
  automatically (they're fields on `PositionUpdateProposal`, which the route serializes
  verbatim). **Additive — export `version` stays `1`.** Documented in `docs/hermes-integration.md`.

**Verification**

- `scripts/verify-identity-calibration.ts` (new) + `package.json` `verify:identity-calibration`.

## Migration additions the orchestrator must run

`npm run migrate` (idempotent). New this change: on the existing **Position Proposals** DB it
adds two additive properties —

| Property | Notion type | Options / notes |
|---|---|---|
| `Target Type` | select | `position`, `voice`, `constitution`, `workflow`, `unclassified` |
| `Target Ref` | rich_text | platform key (voice/workflow) or free label |

No env-var changes. No new DB. All other content/proposal/event DBs are unaffected.

## How to verify

1. Orchestrator runs `npm run migrate` (adds `Target Type` / `Target Ref` to the proposals DB).
2. `npm run verify:identity-calibration -- --url http://localhost:3000` — with
   `HERMES_API_TOKEN` set, creates throwaway drafts, drives an `edit` and a
   `reject`-with-reason through `POST /api/hermes/decisions`, asserts a `voice` and an
   `unclassified` amendment were generated, PATCHes + accepts one, and archives every page it
   created (drafts, amendments, and the calibration events pointing at those drafts). Exits `0`
   with a skip message if `HERMES_API_TOKEN` (or `DS_PROPOSALS`) is unset.
3. `npx tsc --noEmit` — clean (verified).
4. Manual smoke against `npm run dev`: edit or reject-with-reason a draft in the queue → a
   pending amendment appears in the IDENTITY CALIBRATION panel; EDIT/classify it, ACCEPT →
   the standing note holds (Positions Library / packs unchanged).

## Limitations

- **Never auto-applied.** ACCEPT flips `Status` to `accepted` only. Writing an amendment back
  to any canonical file (Positions Library, voice/constitution/workflow packs, the survey
  page, the twin repo) stays a manual human step — there is no `applied`-writing path.
- **Deterministic, never invented.** Voice amendments are the edited text verbatim;
  unclassified amendments are the rejection reason verbatim. No LLM classification — Isaac
  reclassifies via the panel's select. A reject with no reason yields nothing (honest boundary).
- Idempotency for draft amendments is per source-event-id (a repeat edit/reject is a *new*
  event, so it legitimately generates a new amendment). Survey proposals keep their
  per-position idempotency (unchanged).
- `targetRef` for draft amendments is the platform key only; survey position proposals leave
  it blank (the position id lives in `affectedPositionId`).
- Amendment generation runs inline on the approve/reject/edit action (fire-and-forget). A
  generation failure is swallowed with a warning — the user's action always succeeds.

## Rollback

- Code: `git revert` this change's commit — removes the panel, the PATCH route, the draft
  amendment generator + its wiring in `lib/actions.ts`, the reject-reason UI/route, the edit
  UX upgrade, and the migration/doc additions. `ProposalsPanel.tsx` was deleted; the revert
  restores it.
- Notion: the two new props are additive — leave them or remove `Target Type` / `Target Ref`
  from the Position Proposals DB in the UI. Existing rows keep working (readers default a
  missing `Target Type` to `position`). Amendment rows are ordinary proposal rows; archive
  them in Notion if desired.
- No canonical data is ever touched by this layer, so there is nothing to un-apply.
