<!--
  Append this section to runbooks/hermes-twin-runtime.md in the twin repo
  (isaacsplash18/hermes-context), after "Still needs external credentials or
  source details". Heading level and tone match the rest of that file.
  Source: hermes/ in the Command Center repo, Phase 6
  (docs/hermes-calibration-plan.md §4.5).
-->

## Calibration sync worker

1. `scripts/sync_command_center_calibration.py` pulls calibration state from
   the Command Center's machine lane (`GET /api/hermes/export`) and writes a
   plain-English report to `inbox/calibration/YYYY-MM-DD.md`.
2. Run it right after the existing repo pull, on the same cadence (every 30
   minutes):
   ```bash
   cd ~/twin
   ./scripts/pull_identity.sh
   python3 scripts/sync_command_center_calibration.py
   ```
3. It prints nothing and writes nothing when there is no new calibration
   event and no change to pending/accepted proposals — safe to run on a
   timer without flooding logs.
4. When it does have something to report, it prints exactly one line:
   `calibration report written: inbox/calibration/YYYY-MM-DD.md`.
5. Env: `COMMAND_CENTER_URL` and `HERMES_API_TOKEN` (see `.env.example`).
   Without `HERMES_API_TOKEN` set, the script exits `2` on a real run (or
   prints a structure-only stub under `--dry-run`) — it does not silently
   no-op.
6. Exit codes: `0` success (written or silent), `2` missing token, `3`
   export failed validation (nothing written), `4` network/timeout/malformed
   response. Codes `2`–`4` print one line to stderr and nothing else — safe
   for a cron log.

### What Hermes should do with `inbox/calibration/`

- Treat these reports as read-only signal, the same way `inbox/` in general
  is unsorted notes to review, not a place to act automatically.
- Surface the "Needs Isaac review" section of the latest report when asked
  for a status update or when starting a drafting session — this is the
  set of pending calibration proposals plus the current drafts-awaiting-
  review count.
- Never apply a proposal from these reports to `packs/positions.md` or any
  other identity file. A proposal being "accepted" in the Command Center
  only means Isaac approved the *proposal* for further consideration — the
  report says so explicitly under "Accepted, not yet applied." Applying a
  change to canonical Positions is a manual step Isaac does himself (or
  a future, explicitly separate "apply" action — not this worker).
- If a report references calibration events or proposals Hermes doesn't
  otherwise have context for, that's expected — this worker's job is to
  surface signal, not to re-derive it locally.

### Still needs external credentials or source details (calibration sync)

- `HERMES_API_TOKEN` — generated at the Command Center final gate. Ask Isaac
  or the orchestrator for the value; never invent one.

Until that token is set, `scripts/sync_command_center_calibration.py` can
still be exercised with `--dry-run` (shows a structure-only stub without a
token) so the shape of the report is visible before the machine lane is
fully wired up.
