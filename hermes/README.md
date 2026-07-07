# hermes/ — Command Center → twin-repo deliverables

This directory holds everything the Isaac Twin Command Center produces for
the Hermes twin runtime (the Mac mini repo, `isaacsplash18/hermes-context`,
locally at `~/twin`). It is built here, in the Command Center repo, and
shipped to the twin repo on a branch (`calibration-bridge`) — see
`docs/hermes-calibration-plan.md` §4.5. Nothing under `hermes/` is deployed
by the Command Center itself; it exists to be copied or merged onto the Mac
mini.

## What's here

- `scripts/sync_command_center_calibration.py` — the worker. Fetches
  `GET /api/hermes/export` (docs/hermes-integration.md), validates it, and
  writes a plain-English report to `inbox/calibration/YYYY-MM-DD.md` in the
  twin repo. Stdlib-only Python 3, safe to run repeatedly, silent when
  nothing changed.
- `scripts/fixtures/export-sample.json` — a static example export payload
  matching docs/hermes-integration.md's documented response shape, used only
  for `--fixture` test runs (see Testing below). Not consumed by the real
  cron path.
- `.env.example` — the two env vars the worker needs, plus the optional
  `TWIN_ROOT` override.
- `runbooks/hermes-twin-runtime-additions.md` — a section written to be
  appended to the twin repo's existing `runbooks/hermes-twin-runtime.md`.
- `export-preview/` — Phase 11 exporter output (owned by a different phase;
  not part of this deliverable).

## Installing on the Mac mini

The worker expects to live at `<twin repo>/scripts/sync_command_center_
calibration.py` — i.e. directly under the twin repo root's `scripts/`
directory, matching where `pull_identity.sh` and `gate_draft.sh` already
live.

Once the orchestrator pushes the `calibration-bridge` branch to
`isaacsplash18/hermes-context`:

```bash
cd ~/twin
git fetch origin calibration-bridge
git merge --ff-only origin/calibration-bridge   # or review + merge as a PR
```

That lands:

- `scripts/sync_command_center_calibration.py`
- `.env.example` additions (merge the two new lines into the twin repo's own
  `.env` by hand — real secrets never travel through git)
- the runbook addition (see below — append it to `runbooks/hermes-twin-
  runtime.md` if the merge doesn't already do it as a clean append)

Then set the real values in `~/twin/.env` (or however the Mac mini's cron
environment is configured):

```bash
COMMAND_CENTER_URL=https://isaac-twin-command-center.vercel.app
HERMES_API_TOKEN=<the value from the Command Center final gate — ask Isaac, never invent one>
```

## Scheduling

Hermes cron already pulls the twin repo every 30 minutes
(`scripts/pull_identity.sh` / `pull_identity_quiet.sh` — see
`runbooks/hermes-twin-runtime.md` on the Mac mini). Add this worker to run
**right after** that pull, on the same cadence, e.g. as a second line in
whatever wraps the existing cron job:

```bash
cd ~/twin
./scripts/pull_identity.sh
python3 scripts/sync_command_center_calibration.py
```

Because the script prints nothing and writes nothing when there's no change
(exit 0), it's safe to run every 30 minutes without flooding logs or the
inbox. When it does have something to report, it prints exactly one line:

```text
calibration report written: inbox/calibration/2026-07-07.md
```

## Testing with `--dry-run`

```bash
cd ~/twin
python3 scripts/sync_command_center_calibration.py --dry-run
```

- With `HERMES_API_TOKEN` set: fetches the real export, validates it, and
  prints the report to stdout. Writes nothing (no state file, no report
  file) — safe to run any time.
- Without `HERMES_API_TOKEN` set: prints a clearly labelled
  "NO TOKEN — showing structure only" skeleton instead of exiting, so you
  can see the report shape before wiring up the token.

For local development against `npm run dev` instead of production:

```bash
COMMAND_CENTER_URL=http://localhost:3000 python3 scripts/sync_command_center_calibration.py --dry-run
```

There is also a test-only `--fixture <path>` flag that reads the export JSON
from a local file instead of making an HTTP request (used in this phase's
verification — see `docs/changelogs/phase-6.md`). It is not part of the
production cron path.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — a report was written, or nothing changed and the run was silent. |
| `2` | `HERMES_API_TOKEN` is not set (and this wasn't `--dry-run` / `--fixture`). |
| `3` | The export response failed schema validation. Nothing was written. |
| `4` | Network error, timeout, malformed JSON, or a fixture-read error. |

## Guardrails (verbatim from the calibration plan)

- Never edits `soul.md`, `constitution.md`, `context.md`, `memory.md`, or
  `packs/` — this script only ever writes under `inbox/calibration/`.
- Never applies a proposal. "Accepted" in Command Center is not "applied" —
  applying to canonical Positions stays a manual, human step
  (`docs/hermes-calibration-plan.md` §8 rule 5). The report says this
  explicitly under "Accepted, not yet applied."
- Never publishes anything.
- Never prints or logs `HERMES_API_TOKEN`.
