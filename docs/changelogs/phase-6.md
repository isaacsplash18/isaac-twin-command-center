# Phase 6 — Hermes Sync Worker

*Companion to `docs/hermes-calibration-plan.md` §4.5 / §9 and
`docs/build-brief.md` "Phase 6 — Hermes Worker Script". This phase produced
no app code — everything lives under `hermes/` for shipment to the
`isaacsplash18/hermes-context` repo on the `calibration-bridge` branch.*

## Files added

- `hermes/scripts/sync_command_center_calibration.py` — the worker. Python 3,
  standard library only (`argparse`, `hashlib`, `json`, `os`, `sys`,
  `urllib`, `datetime`, `pathlib`). Fetches `GET {COMMAND_CENTER_URL}/api/
  hermes/export?since=<ISO>` with `Authorization: Bearer $HERMES_API_TOKEN`,
  validates the response with an explicit hand-written validator (no schema
  library), and writes `inbox/calibration/YYYY-MM-DD.md` in the twin repo.
  Idempotent and silent when nothing changed. Never touches identity files,
  never applies a proposal, never publishes, never prints the token.
- `hermes/scripts/fixtures/export-sample.json` — a static export payload
  matching `docs/hermes-integration.md`'s documented example, used only by
  the test-only `--fixture` flag for this phase's verification (see below).
- `hermes/.env.example` — `COMMAND_CENTER_URL`, `HERMES_API_TOKEN`,
  `TWIN_ROOT` (optional override), each with a comment.
- `hermes/README.md` — what `hermes/` is, how to install on the Mac mini
  (merge the `calibration-bridge` branch), how to schedule (same cadence as
  the existing `pull_identity.sh` cron pull), how to test with `--dry-run`,
  exit-code table.
- `hermes/runbooks/hermes-twin-runtime-additions.md` — a section written to
  be appended to the twin repo's own `runbooks/hermes-twin-runtime.md`
  (heading style matched from the reference clone), covering the worker's
  contract, exit codes, and — critically — what Hermes is and is not allowed
  to do with `inbox/calibration/` reports (surface "needs review," never
  apply).
- this file.

## New env vars

- `HERMES_API_TOKEN` — already exists (Phase 5, `docs/hermes-integration.md`).
  This phase only documents it in `hermes/.env.example` for the Mac-mini
  side; it generates no new token and stores no real value.
- `COMMAND_CENTER_URL` — already exists conceptually as the deployment URL;
  documented here as the worker's env var, defaulting to
  `https://isaac-twin-command-center.vercel.app` if unset.
- `TWIN_ROOT` — new, worker-only, optional. Overrides where the script
  resolves the twin repo root (defaults to two directories up from the
  script's own location, i.e. correct once the script lives at `<twin repo>/
  scripts/sync_command_center_calibration.py`).

No Vercel-side or Notion-side env vars were touched. No `npm run migrate`,
no build, no git commands, no dev server were run by this phase, per the
parallel-batch constraints.

## How verified

All verification was local (no builds, no servers, per constraints) and
targeted the *shipped* import path (`<root>/scripts/sync_command_center_
calibration.py`) via `TWIN_ROOT` overrides.

**1. Compiles cleanly:**

```
$ python3 -m py_compile hermes/scripts/sync_command_center_calibration.py
PY_COMPILE_OK
```

**2. `--dry-run`, no token (structure-only stub path):**

```
$ env -u HERMES_API_TOKEN python3 hermes/scripts/sync_command_center_calibration.py --dry-run
# Calibration sync — 7 July 2026 (DRY RUN — NO TOKEN — showing structure only)

HERMES_API_TOKEN is not set, so this is a structural preview, not a live report.
Set HERMES_API_TOKEN (see hermes/.env.example) and re-run --dry-run for real data.

## New calibration events
(new CalibrationEvents since the last watermark, grouped by action, would appear here)

## Pending proposals (awaiting Isaac's ACCEPT/REJECT)
(topic, confidence, proposed text and reason — one entry per pending proposal)

## Accepted, not yet applied
Accepted in Command Center but NOT applied to canonical files — apply manually.
(topic, confidence, proposed text and reason — one entry per accepted proposal)

## Needs Isaac review
(pending proposal count + drafts.pendingReview count)

exit=0
```

**3. `--dry-run --fixture` against a real-shaped payload (no server started —
`--fixture` reads `hermes/scripts/fixtures/export-sample.json` directly,
matching the constraint that this phase may not start any dev server):**

```
$ env -u HERMES_API_TOKEN python3 hermes/scripts/sync_command_center_calibration.py --dry-run --fixture hermes/scripts/fixtures/export-sample.json
# Calibration sync — 7 July 2026

Source: Command Center export (`GET /api/hermes/export`), generated 2026-07-07T09:00:00.000Z.
Window: calibration events on or after 2026-06-30T10:48:37.545361Z.

## New calibration events

### approve (1)
- **Why portability beats permanence** — event `5e6f7a8b-event-approve`, 6 July 2026

### sharpen (1)
- **Should Isaac take unsolicited investor calls?** — event `1a2b3c4d-event-sharpen`, 6 July 2026
  > Only if a mutual intro vouches for them first.
  Affected positions: 7f8e9d-position-page-id

## Pending proposals (awaiting Isaac's ACCEPT/REJECT)

- **Unsolicited investor calls** — confidence: medium
  Proposed: "Only if a mutual intro vouches for them first."
  Reason: Isaac's own words from a SHARPEN verdict on the weekly survey

## Accepted, not yet applied

Accepted in Command Center but NOT applied to canonical files — apply manually.

None.

## Needs Isaac review

- 1 pending proposal(s) awaiting ACCEPT/REJECT — see "Pending proposals" above.
- 3 draft(s) waiting in the approval queue (Status: Draft).

exit=0
```

**4. Quiet-path double-run, real write logic under a temp `TWIN_ROOT`
(`/tmp/twin-root-test`, state-file writes under `/tmp` only — no writes to
this repo or the twin repo):**

```
$ TWIN_ROOT=/tmp/twin-root-test python3 hermes/scripts/sync_command_center_calibration.py --fixture hermes/scripts/fixtures/export-sample.json
calibration report written: inbox/calibration/2026-07-07.md
exit=0

$ TWIN_ROOT=/tmp/twin-root-test python3 hermes/scripts/sync_command_center_calibration.py --fixture hermes/scripts/fixtures/export-sample.json
exit=0
(no stdout on the second run — quiet path confirmed)
```

State file after run 1:

```json
{
  "reportHash": "5d9a75a0257d7ac3b421429e5d80fa7458875be82dc23bc27a2e3d09e9db8392",
  "since": "2026-07-07T09:00:00.000Z"
}
```

**5. Standing-state-change path (no new events, but a proposal's status
changed) correctly re-triggers a write, then goes quiet again on repeat** —
verified with a second fixture derived from the sample (pending proposal
moved to `accepted`, `events: []`): first run wrote a new report (exit 0,
one line printed), second run against the same derived fixture was silent
(exit 0, no output). This confirms the report hash covers `proposals` /
`drafts` / `publisher` / `warnings` — not just the events window — matching
the spec's "accepted-awaiting-application proposals" requirement even when
no new CalibrationEvent exists.

**6. Exit-code table, each exercised directly:**

| Code | Trigger tested | Confirmed output |
|---|---|---|
| `0` | Normal write, and quiet repeat run | see §3 above |
| `2` | `HERMES_API_TOKEN` unset, non-`--dry-run` | `HERMES_API_TOKEN is required (set it in the environment -- see hermes/.env.example)` |
| `3` | Fixture with `version: 2` and `publisher` removed | `export validation failed:` + `- version: expected 1, got 2` + `- publisher: expected object, got NoneType` |
| `4` | `COMMAND_CENTER_URL=http://127.0.0.1:1` (connection refused) | `export request failed: [Errno 61] Connection refused` |
| `4` | `--fixture /tmp/does-not-exist.json` | `could not read fixture file ...: [Errno 2] No such file or directory` |

No traceback was printed in any failure case — every path is caught and
reduced to a one-line stderr message plus an explicit exit code.

## Limitations

- The `--fixture` flag is test-only and undocumented as a production
  feature in the runbook beyond "how this phase was verified" — it is not
  wired into the cron path described in `hermes/README.md` /
  `hermes/runbooks/hermes-twin-runtime-additions.md`.
- The report's content hash covers `proposals`, `drafts`, `publisher`, and
  `warnings`, but deliberately *excludes* `events` — the "no new events"
  check is a separate boolean. This means a change to `data["since"]` alone
  (e.g. the export's echoed default drifting) does not by itself trigger a
  rewrite; only actual content changes (new events, or a proposals/drafts/
  publisher/warnings diff) do. This matches the "silent when nothing
  changed" requirement but means the stored watermark can only be verified
  indirectly (via the state file), not from the report body itself.
- `since` filtering is enforced twice: once by the server (per `docs/
  hermes-integration.md`) and once client-side in this script (comparing
  each event's `createdAt` against the locally-resolved `since`). This is
  intentional defence-in-depth — it makes the script's idempotency
  independent of the server actually honouring `since` correctly, and it is
  what makes the `--fixture` (static file, no server-side filtering)
  verification meaningful — but it means a server bug that returns
  already-seen events would be silently filtered out rather than surfaced.
- No retry/backoff on network errors — a single failed request exits `4`
  immediately. Acceptable for a 30-minute cron cadence (the next run retries
  naturally) but worth knowing if the endpoint has any transient flakiness.
- The report renders proposal `currentPositionText` nowhere in the "Pending
  proposals" / "Accepted, not yet applied" sections (only `proposedPositionText`
  and `reason`) — the export does carry `currentPositionText` but the build
  brief's requirement list didn't ask for a before/after diff in the report,
  only "topic, confidence, proposed text, reason." Easy to add if Isaac wants
  the current text shown too.
- State file corruption (unreadable/invalid JSON) is treated as "first run"
  rather than an error — this favours availability (the worker keeps
  running) over strict correctness (a corrupted watermark silently resets to
  7-days-ago on the next run, which could reprint recently-seen events as
  "new"). No corruption was observed in testing; this is a design choice,
  documented here for visibility.

## Uncertainties

- The exact production install location on the Mac mini
  (`~/twin/scripts/sync_command_center_calibration.py`) was inferred from
  the build brief and the reference clone's existing `scripts/` layout
  (`pull_identity.sh`, `gate_draft.sh`) — not confirmed against the live
  Mac mini filesystem, which this phase had no access to.
- The cron wrapper that currently runs `pull_identity.sh` every 30 minutes
  was not inspected directly (no access to the Mac mini's actual crontab/
  launchd config) — `hermes/README.md`'s scheduling section is a
  recommendation ("run this script right after the pull, same cadence"),
  not a verified edit to an existing schedule.

## Rollback

- Code: this is a documentation-and-script-only phase with no shared-file
  edits. `git revert` the commit that adds `hermes/scripts/`, `hermes/
  .env.example`, `hermes/README.md`, `hermes/runbooks/hermes-twin-runtime-
  additions.md`, and this changelog — nothing else in the Command Center
  repo depends on them.
- Twin repo: rollback is deleting the `calibration-bridge` branch before
  merge (per `docs/hermes-calibration-plan.md` §7, "Hermes side:
  deliverables live on a non-main branch; rollback = delete branch"). If
  already merged to the twin repo's main, revert that merge commit — the
  worker only ever writes under `inbox/calibration/`, so removing the script
  and deleting that directory fully undoes its footprint. No identity file
  is ever touched, so there is nothing else to unwind.
- Env: unset `HERMES_API_TOKEN` in the Mac mini's cron environment to make
  every real run exit `2` immediately (fail closed, same as the server-side
  machine lane per `docs/hermes-integration.md`).
