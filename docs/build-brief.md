# Claude Code Build Instructions — Isaac Twin / Hermes Calibration System

Use this file as the instruction brief for Claude Code.

## Purpose

We are building the missing infrastructure that connects the **Isaac Twin Command Center** with the **Hermes twin runtime**.

The goal is **not** to build a vague “AI twin” in one pass.

The goal is to build a governed, inspectable, restartable calibration system in small vertical slices:

```text
Command Center action
  ↓
Persist calibration event
  ↓
Generate pending position update proposal
  ↓
Show proposal in dashboard
  ↓
Expose machine-readable state to Hermes
  ↓
Hermes can draft, gate, sync, and report
  ↓
Human approval remains required before publishing or identity mutation
```

---

## Current Known Architecture

### Existing live app

The live Command Center is at:

```text
https://isaac-twin-command-center.vercel.app
```

Observed current state:

- Passphrase login works.
- Dashboard shows approval queue.
- Recently posted items are visible.
- Recently rejected items are visible.
- Positions library counts are visible.
- Calibration card exists with:
  - `CONFIRM`
  - `SHARPEN`
  - `REJECT`
  - free-text input
  - `SUBMIT`
  - `LATER`
- Automations are shown as **CONFIG, NOT LIVE**.

### Existing Hermes runtime

Hermes already has a local twin runtime:

```text
~/twin -> /Users/lovomacmini/projects/hermes-context
```

Known Hermes pieces:

- GitHub-backed context repo exists.
- `~/twin/soul.md` exists.
- `~/twin/constitution.md` exists.
- `~/twin/.hermes.md` defines runtime rules.
- `~/twin/AGENTS.md` points to `constitution.md`.
- `~/.hermes/SOUL.md` points to `~/twin/soul.md`.
- Hermes `terminal.cwd` is set to `/Users/lovomacmini/twin`.
- Hermes cron job `twin-repo-pull` runs every 30 minutes.
- `humanizer_check.py` exists.
- Telegram gateway is connected.

### Important design rule

The current contract is:

```text
Notion = human source of truth
GitHub = versioned machine-readable artifact store
Command Center = dashboard / control plane
Hermes = runtime / orchestrator / worker
Claude Code = builder of repo code
```

Hermes should **not** silently mutate canonical identity files.

Command Center and Hermes may create proposals, reports, and pending changes, but Isaac must approve canonical changes.

---

## Non-Negotiable Guardrails

Follow these throughout the project:

1. **Do not publish anything.**
2. **Do not mutate canonical identity files automatically.**
3. **Do not store secrets in code.**
4. **Do not invent external credentials.**
5. **Do not fake Notion, Typefully, Telegram, or publisher success.**
6. **Prefer small, reversible changes.**
7. **Preserve existing UI unless the task explicitly requires a UI change.**
8. **Add docs for every new endpoint, script, worker, and env var.**
9. **Add tests or a verification script for each phase.**
10. **If uncertain about data source or schema, stop and ask.**
11. **All identity updates must become pending proposals first.**
12. **Publishing must always require explicit Isaac approval.**

---

## Desired End-State

Eventually, the system should support this loop:

```text
Notion / GitHub identity context
  ↓
Hermes loads soul + constitution + relevant packs
  ↓
Hermes creates a draft
  ↓
Humanizer gate runs
  ↓
Draft appears in Command Center
  ↓
Isaac approves / edits / rejects in Command Center or Telegram
  ↓
Decision is persisted as a CalibrationEvent
  ↓
System proposes a PositionUpdateProposal if belief/voice changed
  ↓
Isaac accepts/rejects proposal
  ↓
Approved canonical changes flow back to Notion / GitHub
  ↓
Future drafts use updated context
```

This should produce **Versioned Isaac**, not frozen Isaac and not vibes Isaac.

---

# Phase 0 — Locate and Inspect the Command Center Repo

## Prompt to run in Claude Code

```text
Find the local repo for the Isaac Twin Command Center app.

Search my home directory for a Next.js/Vercel app whose title or code references:
- "Isaac Twin"
- "Command Center"
- "positions"
- "drafts"
- "calibration"

Do not modify files yet.

Report:
1. Candidate repo path(s)
2. Which one appears to be the deployed Command Center
3. Framework and stack
4. Package manager
5. Data sources
6. Existing API routes / server actions
7. Existing env vars
8. How to run locally
9. How to build/test/lint
```

Expected output: inspection report only. No code changes.

---

# Phase 1 — Inspect Current Implementation

Run Claude Code in the Command Center repo:

```bash
cd /path/to/isaac-twin-command-center
claude
```

Then paste:

```text
We are building the missing Hermes/Isaac Twin calibration layer.

Important context:
- The live app is the Isaac Twin Command Center.
- It already shows:
  - approval queue
  - recently posted/rejected items
  - positions library counts
  - a calibration card with CONFIRM / SHARPEN / REJECT / SUBMIT / LATER
  - automations listed as CONFIG, NOT LIVE
- Hermes already has a local twin runtime at ~/twin, backed by the GitHub repo isaacsplash18/hermes-context.
- Hermes loads soul.md and constitution.md.
- Hermes has a cron job that pulls the twin repo every 30 minutes.
- What is missing is the live governed calibration loop.

Your task for now is INSPECTION ONLY.

Please inspect this repo and answer:
1. What framework is this app using?
2. Where are drafts loaded from?
3. Where are posted/rejected items loaded from?
4. Where are positions loaded from?
5. Where are approvals/rejections/edits currently handled?
6. Is there already a database, API route, server action, or Notion client?
7. Is the calibration card currently persisted, or only UI?
8. What env vars are required?
9. What is the smallest safe implementation plan for the first calibration loop?

Do not modify files yet.
```

---

# Phase 2 — Create Architecture Plan File

After inspection, ask Claude Code:

```text
Create a file called docs/hermes-calibration-plan.md.

It should contain:
1. Current architecture summary
2. Current data model/data sources
3. Missing pieces
4. Proposed v1 calibration architecture
5. Exact files to change
6. Proposed types/models
7. API endpoints or server actions to add
8. Test/verification plan
9. Rollback plan

Do not implement yet.
```

Do not proceed until this plan is reviewed.

---

# Phase 3 — Persist Calibration Events

Goal: every meaningful user action becomes a structured event.

## Claude Code prompt

```text
Implement Phase 1 only: persistent calibration events.

Goal:
When a user clicks APPROVE, REJECT, EDIT, CONFIRM, SHARPEN, SUBMIT, or LATER in the Command Center, the app should persist a structured CalibrationEvent.

Requirements:
1. Add a CalibrationEvent type/model with fields:
   - id
   - createdAt
   - source: "command_center"
   - objectType: "draft" | "position" | "calibration_card" | "wiki_note"
   - objectId
   - platform: "x" | "linkedin" | "ig_story" | "ig_carousel" | "unknown"
   - topic
   - action: "approve" | "reject" | "edit" | "confirm" | "sharpen" | "submit" | "later"
   - rawUserText
   - previousText
   - newText
   - affectedPositionIds
   - inferredDelta
   - status: "pending" | "accepted" | "rejected" | "applied"
2. Use the existing persistence layer if one exists.
3. If there is no database yet, create the smallest repo-consistent persistence layer. Prefer the app’s existing style.
4. Do not auto-change confirmed positions.
5. Do not publish anything.
6. Add a simple way to view recent CalibrationEvents in the app or via an API endpoint.
7. Add tests or a verification script.
8. Update docs/hermes-calibration-plan.md with what changed.

After implementation, run the relevant tests/build/lint commands and report results.

Guardrails:
- Do not publish anything.
- Do not mutate canonical identity files automatically.
- Do not store secrets in code.
- Do not invent external credentials.
- Prefer small, reversible changes.
- Preserve existing UI unless needed.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

## Acceptance criteria

- Clicking an approval/rejection/calibration control creates a persistent event.
- Events survive refresh/restart if the app has durable persistence.
- There is a way to inspect recent events.
- No canonical positions are modified.
- No publishing occurs.

---

# Phase 4 — Pending Position Update Proposals

Goal: convert calibration signals into reviewable proposals, not automatic belief changes.

## Claude Code prompt

```text
Implement Phase 2 only: pending position proposals.

Goal:
Convert calibration events into pending PositionUpdateProposal records, but do not apply them automatically.

Requirements:
1. Add a PositionUpdateProposal type/model with:
   - id
   - createdAt
   - updatedAt
   - sourceEventIds
   - affectedPositionId
   - topic
   - currentPositionText
   - proposedPositionText
   - reason
   - evidenceSummary
   - confidence: "low" | "medium" | "high"
   - status: "pending" | "accepted" | "rejected" | "applied"
2. Add logic that can create a proposal from one or more CalibrationEvents.
3. For now, use a deterministic placeholder if no LLM worker exists:
   - group by topic/objectId
   - create a pending proposal requiring human review
   - do not pretend to infer a final belief if evidence is insufficient
4. Add a “Proposed Updates” panel to the Command Center.
5. The panel should show:
   - topic
   - current position
   - proposed change
   - evidence/reason
   - accept/reject buttons
6. Accepting a proposal should mark it accepted, but should not yet mutate the canonical GitHub/Notion identity files.
7. Add tests or a verification script.
8. Run tests/build/lint and report results.

Guardrails:
- Do not publish anything.
- Do not mutate canonical identity files automatically.
- Do not store secrets in code.
- Do not invent external credentials.
- Prefer small, reversible changes.
- Preserve existing UI unless needed.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

## Acceptance criteria

- Calibration events can produce pending proposals.
- Proposals are visible in the dashboard.
- Accept/reject proposal actions are persisted.
- Accepted proposals do not yet mutate source-of-truth files.

---

# Phase 5 — Hermes-Readable Export

Goal: expose Command Center state in a simple machine-readable format.

## Claude Code prompt

```text
Implement Phase 3 only: Hermes-readable calibration export.

Goal:
Expose pending/accepted calibration data in a simple machine-readable format that Hermes can read.

Requirements:
1. Add an authenticated API endpoint or export file for:
   - recent CalibrationEvents
   - pending PositionUpdateProposals
   - accepted PositionUpdateProposals
2. Format should be JSON.
3. Include stable IDs and timestamps.
4. Do not expose secrets.
5. Document the endpoint/export in docs/hermes-integration.md.
6. Add example curl commands.
7. Add a local verification script that fetches the export and validates schema.
8. Run tests/build/lint and report results.

Guardrails:
- Do not publish anything.
- Do not mutate canonical identity files automatically.
- Do not store secrets in code.
- Do not invent external credentials.
- Prefer small, reversible changes.
- Preserve existing UI unless needed.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

## Acceptance criteria

- Hermes can fetch JSON calibration state.
- Endpoint/export is documented.
- Schema is validated by a script or test.
- Endpoint is authenticated or otherwise safely protected.

---

# Phase 6 — Hermes Worker Script

This may live in either the Command Center repo or the Hermes context repo. Prefer putting it in:

```text
~/twin/scripts/sync_command_center_calibration.py
```

## Claude Code prompt

```text
Now implement a Hermes worker script for the twin runtime.

Context:
- Hermes twin repo is at ~/twin.
- Hermes loads soul.md and constitution.md.
- Hermes should not silently mutate canonical identity files.
- Notion is the human source of truth.
- GitHub is the versioned machine-readable artifact store.
- Command Center is the dashboard/control plane.

Goal:
Create a script that Hermes cron can run to sync calibration state from the Command Center.

Requirements:
1. Create scripts/sync_command_center_calibration.py or equivalent.
2. It should fetch the Command Center calibration export endpoint.
3. It should validate the JSON schema.
4. It should write a local markdown report to inbox/calibration/YYYY-MM-DD.md.
5. It should summarize:
   - new calibration events
   - pending proposals
   - accepted proposals
   - proposals needing Isaac review
6. It must not apply position changes automatically.
7. It should be safe to run repeatedly.
8. It should produce no output if nothing changed, so Hermes cron can stay quiet.
9. Add docs to runbooks/hermes-twin-runtime.md.
10. Add a sample .env.example entry for any required endpoint/token.
11. Run the script in dry-run mode and show the output.

Guardrails:
- Do not publish anything.
- Do not mutate canonical identity files automatically.
- Do not store secrets in code.
- Do not invent external credentials.
- Prefer small, reversible changes.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

## Acceptance criteria

- Script can fetch calibration export.
- Script validates schema.
- Script writes idempotent reports.
- Script does not mutate identity files.
- Script can run quietly when nothing changed.

---

# Phase 7 — Draft Creation Bridge

Goal: allow Hermes to create draft records in Command Center.

## Claude Code prompt

```text
Implement Phase 5 only: draft creation bridge.

Goal:
Allow Hermes or another worker to create a draft record in the Command Center approval queue.

Requirements:
1. Add an authenticated API endpoint:
   POST /api/drafts or repo-consistent equivalent
2. Request body:
   - platform
   - title/hook
   - body
   - sourcePositionIds
   - sourceWorkflow
   - humanizerStatus
   - status: "pending_review"
   - createdBy: "hermes"
3. Validate input.
4. Store the draft using existing persistence.
5. Show the draft in the existing approval queue.
6. Do not publish.
7. Add docs and curl example.
8. Add test/verification script.
9. Run tests/build/lint.

Guardrails:
- Do not publish anything.
- Do not mutate canonical identity files automatically.
- Do not store secrets in code.
- Do not invent external credentials.
- Prefer small, reversible changes.
- Preserve existing UI unless needed.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

## Acceptance criteria

- Hermes can create a pending draft via API.
- Draft appears in approval queue.
- Draft is not published.
- Request is authenticated and validated.

---

# Phase 8 — Telegram Approval Bridge Design

Design before implementation.

## Claude Code prompt

```text
Design but do not implement yet: Telegram approval bridge.

Goal:
Hermes sends new Command Center drafts to Isaac on Telegram for approve/edit/reject, then writes the decision back to Command Center.

Please produce docs/telegram-approval-bridge.md with:
1. Proposed flow
2. Required Command Center API endpoints
3. Hermes cron/job design
4. Message format
5. How edits are captured
6. How rejections become calibration events
7. Security model
8. Failure modes and retries
9. Minimal implementation steps

Do not code until this design is approved.
```

---

# Phase 9 — Telegram Approval Bridge Implementation

Only after the design is approved.

## Claude Code prompt

```text
Implement the Telegram approval bridge according to docs/telegram-approval-bridge.md.

Goal:
Hermes can send pending drafts to Isaac on Telegram, receive approve/edit/reject decisions, and write those decisions back to Command Center.

Requirements:
1. Use existing Hermes Telegram gateway where possible.
2. Do not create a second competing Telegram bot unless necessary.
3. Support approve/reject/edit actions.
4. Edits should create CalibrationEvents.
5. Rejections should create CalibrationEvents with rejection reason if supplied.
6. The Command Center should reflect the decision state.
7. The system must be idempotent and retry-safe.
8. Add docs and verification steps.
9. Do not publish anything.

Guardrails:
- Do not publish anything.
- Do not mutate canonical identity files automatically.
- Do not store secrets in code.
- Do not invent external credentials.
- Prefer small, reversible changes.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

---

# Phase 10 — Publisher Integration

Do this last.

## Claude Code prompt

```text
Implement publisher integration only after approval flow is working.

Goal:
Approved drafts can be queued/published through Typefully or the chosen publisher.

Requirements:
1. Never publish without explicit approval.
2. Store publisher status:
   - not_queued
   - queued
   - published
   - failed
3. Store publisher URL/id.
4. On failure, surface the failure in Command Center.
5. Add retry-safe behavior.
6. Add docs and tests.
7. Do not enable automatic publishing by default.
8. If Typefully credentials are missing, implement the interface and dry-run mode only.

Guardrails:
- Do not publish anything unless explicitly testing in dry-run mode or after Isaac approval.
- Do not mutate canonical identity files automatically.
- Do not store secrets in code.
- Do not invent external credentials.
- Prefer small, reversible changes.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

---

# Phase 11 — Notion Exporter

Build after Command Center data model is stable.

## Claude Code prompt

```text
Implement the Notion exporter only after calibration events and proposals are working.

Goal:
Export the human source-of-truth identity data from Notion into the Hermes context repo as machine-readable markdown.

Context:
- Notion is the human source of truth.
- GitHub repo ~/twin is the versioned machine-readable artifact store.
- Hermes pulls this repo every 30 minutes.

Requirements:
1. Identify required Notion pages/databases:
   - soul / voice
   - constitution
   - positions
   - platform workflows
   - wiki/context if available
2. Do not invent missing Notion IDs.
3. If credentials or IDs are missing, create a documented .env.example and stop.
4. Export to:
   - soul.md
   - constitution.md
   - context.md
   - packs/voice.md
   - packs/positions.md
   - packs/constitution-full.md
   - packs/workflows/x.md
   - packs/workflows/linkedin.md
   - packs/workflows/ig-story.md
   - packs/workflows/ig-carousel.md
   - packs/workflows/substack.md
5. Preserve frontmatter where useful.
6. Add dry-run mode.
7. Add validation that required files are not empty.
8. Add docs to runbooks/hermes-twin-runtime.md.
9. Do not overwrite canonical files without backup.
10. Do not commit/push unless explicitly requested.

Guardrails:
- Do not publish anything.
- Do not store secrets in code.
- Do not invent external credentials or Notion IDs.
- Prefer small, reversible changes.
- Add docs for every new endpoint/script.
- Add verification steps.
- If uncertain about data source or schema, stop and ask.
```

---

# Recommended Build Order

Use this order. Do **not** ask Claude Code to build all phases at once.

```text
1. Locate repo
2. Inspect current implementation
3. Write docs/hermes-calibration-plan.md
4. Persist CalibrationEvents
5. Add PositionUpdateProposals
6. Add Hermes-readable export
7. Add Hermes sync worker
8. Add draft creation bridge
9. Design Telegram approval bridge
10. Implement Telegram approval bridge
11. Add publisher integration
12. Add Notion exporter
```

---

# After Every Phase, Ask Claude Code This

```text
Before moving on, provide:
1. Files changed
2. New env vars
3. Commands run
4. Test/build/lint results
5. Manual verification steps
6. Known limitations
7. Rollback instructions
8. Next recommended phase
```

---

# Commit Discipline

After each completed phase:

```bash
git status
git diff
npm test # or repo-specific test command
npm run build # or repo-specific build command
git add .
git commit -m "feat: add calibration events"
```

Use specific commit messages, for example:

```text
feat: add calibration event persistence
feat: add position update proposals
feat: expose hermes calibration export
feat: add hermes calibration sync worker
docs: document telegram approval bridge
feat: add draft creation API for hermes
```

---

# Final Architecture Target

The target architecture should look like this:

```text
Isaac
  ├─ Command Center
  │   ├─ approval queue
  │   ├─ calibration events
  │   ├─ position proposals
  │   └─ performance/status dashboard
  │
  ├─ Telegram
  │   └─ fast mobile approve/edit/reject lane
  │
  ├─ Notion
  │   └─ human source of truth
  │
  ├─ GitHub / ~/twin
  │   └─ machine-readable context repo
  │
  └─ Hermes
      ├─ pulls ~/twin
      ├─ loads soul + constitution
      ├─ drafts using platform packs
      ├─ runs humanizer gate
      ├─ sends drafts to Command Center / Telegram
      ├─ reads calibration export
      ├─ writes reports/proposals
      └─ never publishes or mutates identity without approval
```

---

# Definition of Done

This project is “v1 complete” when:

- [ ] Command Center persists approve/edit/reject/calibration actions.
- [ ] CalibrationEvents are inspectable.
- [ ] Pending PositionUpdateProposals are generated and inspectable.
- [ ] Proposals can be accepted/rejected without mutating canonical identity files.
- [ ] Hermes can fetch calibration export as JSON.
- [ ] Hermes sync worker can write calibration reports locally.
- [ ] Hermes can create draft records in Command Center.
- [ ] Telegram approval flow is designed and implemented.
- [ ] Publishing is gated by explicit approval.
- [ ] Notion exporter is documented or implemented with real credentials/IDs.
- [ ] Every new endpoint/script has docs and verification steps.
- [ ] No secrets are committed.
- [ ] No publishing occurs without explicit approval.

---

# First Prompt To Use

Start with this exact prompt:

```text
You are working on the Isaac Twin Command Center.

The goal is to turn the existing dashboard into a governed Hermes-compatible calibration system.

Current known state:
- Live Command Center exists.
- It shows approval queue, posted/rejected content, positions library counts, calibration card, and automations.
- Automations are currently "CONFIG, NOT LIVE".
- Hermes already has a local twin runtime at ~/twin:
  - soul.md
  - constitution.md
  - .hermes.md runtime rules
  - humanizer_check.py
  - GitHub-backed repo isaacsplash18/hermes-context
  - cron job pulling the repo every 30 min
- Missing: live Command Center ↔ Hermes bridge, persisted calibration events, pending position update proposals, Telegram approval bridge, Notion sync, and publisher integration.

Work incrementally.

First task: inspect only.
Answer:
1. App framework and stack
2. Data sources
3. Existing persistence
4. Existing approval/edit/reject handlers
5. Whether calibration buttons persist anything
6. Existing API routes/server actions
7. Env vars needed
8. Smallest safe implementation plan

Do not modify files until I approve the plan.
```
