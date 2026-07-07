#!/usr/bin/env python3
"""Sync Command Center calibration state into the twin repo's inbox.

Fetches `GET /api/hermes/export` from the Isaac Twin Command Center (the
machine lane documented in docs/hermes-integration.md), validates the
response shape, and writes a plain-English markdown report to
`inbox/calibration/YYYY-MM-DD.md` in the twin repo. Intended to run from
Hermes cron on the Mac mini, on the same cadence as the existing
`scripts/pull_identity.sh` pull (see hermes/runbooks/hermes-twin-runtime-
additions.md).

This script:
- NEVER edits soul.md, constitution.md, context.md, memory.md, or packs/.
- NEVER applies a proposal to a canonical Position. "Accepted" in Command
  Center is not "applied" — that stays a manual, human step (see
  docs/hermes-calibration-plan.md #8 rule 5).
- NEVER publishes anything.
- Is safe to run repeatedly: if nothing has changed since the last run, it
  prints nothing and writes nothing (exit 0), so Hermes cron can stay quiet.

Python 3, standard library only. No pip dependencies -- the Mac mini runs
plain python3.

Usage:
    python3 sync_command_center_calibration.py
    python3 sync_command_center_calibration.py --dry-run
    python3 sync_command_center_calibration.py --dry-run --fixture path/to/export.json

Environment:
    COMMAND_CENTER_URL   Base URL of the Command Center deployment.
                         Default: https://isaac-twin-command-center.vercel.app
    HERMES_API_TOKEN     Bearer token for the machine lane. Required unless
                         --dry-run (or --fixture, which never calls the
                         network at all).
    TWIN_ROOT            Override for the twin repo root. Defaults to the
                         directory two levels up from this file (i.e. this
                         script is expected to live at <twin repo>/scripts/
                         sync_command_center_calibration.py once shipped).

Exit codes:
    0  Success. Either a report was written, or nothing had changed and the
       run was silent.
    2  HERMES_API_TOKEN is not set (and this was not --dry-run / --fixture).
    3  The export response failed validation. Nothing was written.
    4  A network error, timeout, malformed JSON, or fixture-read error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_COMMAND_CENTER_URL = "https://isaac-twin-command-center.vercel.app"
REQUEST_TIMEOUT_SECONDS = 15
STATE_RELATIVE_PATH = Path("inbox") / "calibration" / ".calibration-sync-state.json"
REPORT_DIR_RELATIVE_PATH = Path("inbox") / "calibration"

# Order events are grouped/printed in, matching CalibrationAction
# (lib/calibration-events.ts) rather than arrival order, so the report reads
# the same way run to run.
ACTION_ORDER = ["approve", "reject", "edit", "confirm", "sharpen", "submit", "later"]

EVENT_FIELDS = [
    ("id", "str"),
    ("createdAt", "str_iso"),
    ("source", "str"),
    ("objectType", "str"),
    ("objectId", "str"),
    ("platform", "str"),
    ("topic", "str"),
    ("action", "str"),
    ("rawUserText", "str"),
    ("previousText", "str"),
    ("newText", "str"),
    ("affectedPositionIds", "list_str"),
    ("inferredDelta", "str"),
    ("status", "str"),
]

PROPOSAL_FIELDS = [
    ("id", "str"),
    ("createdAt", "str_iso"),
    ("updatedAt", "str_iso"),
    ("sourceEventIds", "list_str"),
    ("affectedPositionId", "str"),
    ("topic", "str"),
    ("currentPositionText", "str"),
    ("proposedPositionText", "str"),
    ("reason", "str"),
    ("evidenceSummary", "str"),
    ("confidence", "str"),
    ("status", "str"),
]


class WorkerError(Exception):
    """A handled, cron-friendly failure: one-line message, explicit exit code."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def eprint(message: str) -> None:
    print(message, file=sys.stderr)


# --------------------------------------------------------------------------
# Time helpers
# --------------------------------------------------------------------------


def parse_iso(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def default_since() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=7)).isoformat().replace(
        "+00:00", "Z"
    )


def british_date(dt: datetime) -> str:
    return f"{dt.day} {dt.strftime('%B %Y')}"


# --------------------------------------------------------------------------
# Paths / twin root
# --------------------------------------------------------------------------


def resolve_twin_root() -> Path:
    override = os.environ.get("TWIN_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    # This file is expected to live at <twin repo>/scripts/<this file>.py.
    return Path(__file__).resolve().parent.parent


def state_path(twin_root: Path) -> Path:
    return twin_root / STATE_RELATIVE_PATH


def report_path(twin_root: Path, when: datetime) -> Path:
    return twin_root / REPORT_DIR_RELATIVE_PATH / f"{when.strftime('%Y-%m-%d')}.md"


# --------------------------------------------------------------------------
# State file
# --------------------------------------------------------------------------


def load_state(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            return {}
        return data
    except (OSError, json.JSONDecodeError):
        # A corrupt state file should not crash the sync -- treat it as
        # "first run" rather than traceback-spamming a cron log.
        return {}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# Fetch (or fixture read)
# --------------------------------------------------------------------------


def fetch_export(base_url: str, since: str, token: str) -> dict:
    query = urllib.parse.urlencode({"since": since})
    url = f"{base_url.rstrip('/')}/api/hermes/export?{query}"
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        raise WorkerError(4, f"export request failed: HTTP {exc.code} {exc.reason}") from None
    except urllib.error.URLError as exc:
        raise WorkerError(4, f"export request failed: {exc.reason}") from None
    except TimeoutError:
        raise WorkerError(
            4, f"export request timed out after {REQUEST_TIMEOUT_SECONDS}s"
        ) from None

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WorkerError(4, f"export response was not valid JSON: {exc}") from None


def read_fixture(path_str: str) -> dict:
    path = Path(path_str).expanduser()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise WorkerError(4, f"could not read fixture file {path}: {exc}") from None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WorkerError(4, f"fixture file {path} is not valid JSON: {exc}") from None


# --------------------------------------------------------------------------
# Validation (small, explicit -- no schema library)
# --------------------------------------------------------------------------


def _check_field(obj: dict, path: str, name: str, kind: str, errors: list) -> None:
    if name not in obj:
        errors.append(f"{path}.{name}: missing required key")
        return
    value = obj[name]
    if kind == "str":
        if not isinstance(value, str):
            errors.append(f"{path}.{name}: expected str, got {type(value).__name__}")
    elif kind == "str_iso":
        if not isinstance(value, str):
            errors.append(f"{path}.{name}: expected ISO timestamp str, got {type(value).__name__}")
            return
        try:
            parse_iso(value)
        except ValueError:
            errors.append(f"{path}.{name}: not a parseable ISO timestamp: {value!r}")
    elif kind == "list_str":
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            errors.append(f"{path}.{name}: expected list[str], got {value!r}")
    else:  # pragma: no cover - programmer error guard
        raise AssertionError(f"unknown field kind {kind!r}")


def _check_object_list(items, path: str, fields, errors: list) -> None:
    if not isinstance(items, list):
        errors.append(f"{path}: expected list, got {type(items).__name__}")
        return
    for idx, item in enumerate(items):
        item_path = f"{path}[{idx}]"
        if not isinstance(item, dict):
            errors.append(f"{item_path}: expected object, got {type(item).__name__}")
            continue
        for name, kind in fields:
            _check_field(item, item_path, name, kind, errors)


def validate_export(data) -> list:
    errors: list = []
    if not isinstance(data, dict):
        return [f"response body: expected a JSON object, got {type(data).__name__}"]

    if data.get("version") != 1:
        errors.append(f"version: expected 1, got {data.get('version')!r}")

    for key in ("generatedAt", "since"):
        if key not in data:
            errors.append(f"{key}: missing required key")
        elif not isinstance(data[key], str):
            errors.append(f"{key}: expected str, got {type(data[key]).__name__}")
        else:
            try:
                parse_iso(data[key])
            except ValueError:
                errors.append(f"{key}: not a parseable ISO timestamp: {data[key]!r}")

    if "events" not in data:
        errors.append("events: missing required key")
    else:
        _check_object_list(data["events"], "events", EVENT_FIELDS, errors)

    proposals = data.get("proposals")
    if not isinstance(proposals, dict):
        errors.append(f"proposals: expected object, got {type(proposals).__name__}")
    else:
        for bucket in ("pending", "accepted"):
            if bucket not in proposals:
                errors.append(f"proposals.{bucket}: missing required key")
            else:
                _check_object_list(
                    proposals[bucket], f"proposals.{bucket}", PROPOSAL_FIELDS, errors
                )

    drafts = data.get("drafts")
    if not isinstance(drafts, dict):
        errors.append(f"drafts: expected object, got {type(drafts).__name__}")
    elif "pendingReview" not in drafts:
        errors.append("drafts.pendingReview: missing required key")
    elif not isinstance(drafts["pendingReview"], int) or isinstance(
        drafts["pendingReview"], bool
    ):
        errors.append(
            f"drafts.pendingReview: expected int, got {type(drafts['pendingReview']).__name__}"
        )

    publisher = data.get("publisher")
    if not isinstance(publisher, dict):
        errors.append(f"publisher: expected object, got {type(publisher).__name__}")
    elif "mode" not in publisher:
        errors.append("publisher.mode: missing required key")
    elif not isinstance(publisher["mode"], str):
        errors.append(f"publisher.mode: expected str, got {type(publisher['mode']).__name__}")

    warnings = data.get("warnings")
    if not isinstance(warnings, list) or not all(isinstance(w, str) for w in warnings):
        errors.append(f"warnings: expected list[str], got {warnings!r}")

    return errors


# --------------------------------------------------------------------------
# Report content hash (drives the quiet path)
# --------------------------------------------------------------------------


def compute_standing_hash(data: dict) -> str:
    """Hash of everything that is NOT the "new events since last run" window.

    Proposals, the drafts count, publisher mode and warnings can all change
    without a new CalibrationEvent existing (e.g. Isaac accepts a proposal
    that was already pending). The "no new events" check below is a separate,
    explicit condition -- together, "hash unchanged AND no new events" is the
    only case where nothing in the report actually changed.
    """
    standing = {
        "proposals": data.get("proposals"),
        "drafts": data.get("drafts"),
        "publisher": data.get("publisher"),
        "warnings": data.get("warnings"),
    }
    blob = json.dumps(standing, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# Report rendering
# --------------------------------------------------------------------------


def group_events_by_action(events: list) -> dict:
    grouped: dict = {}
    for event in events:
        grouped.setdefault(event["action"], []).append(event)
    return grouped


def render_report(data: dict, new_events: list, since_used: str, run_when: datetime) -> str:
    lines = []
    lines.append(f"# Calibration sync — {british_date(run_when)}")
    lines.append("")
    lines.append(
        f"Source: Command Center export (`GET /api/hermes/export`), "
        f"generated {data['generatedAt']}."
    )
    lines.append(f"Window: calibration events on or after {since_used}.")
    lines.append("")

    lines.append("## New calibration events")
    lines.append("")
    if new_events:
        grouped = group_events_by_action(new_events)
        ordered_actions = ACTION_ORDER + sorted(set(grouped) - set(ACTION_ORDER))
        for action in ordered_actions:
            items = grouped.get(action)
            if not items:
                continue
            lines.append(f"### {action} ({len(items)})")
            for event in items:
                event_date = british_date(parse_iso(event["createdAt"]))
                topic = event["topic"] or "(untitled)"
                lines.append(f"- **{topic}** — event `{event['id']}`, {event_date}")
                if event["rawUserText"]:
                    lines.append(f"  > {event['rawUserText']}")
                if event["affectedPositionIds"]:
                    lines.append(
                        f"  Affected positions: {', '.join(event['affectedPositionIds'])}"
                    )
            lines.append("")
    else:
        lines.append("No new calibration events since the last sync.")
        lines.append("")

    lines.append("## Pending proposals (awaiting Isaac's ACCEPT/REJECT)")
    lines.append("")
    pending = data["proposals"]["pending"]
    if pending:
        for proposal in pending:
            lines.append(f"- **{proposal['topic']}** — confidence: {proposal['confidence']}")
            lines.append(f"  Proposed: \"{proposal['proposedPositionText']}\"")
            lines.append(f"  Reason: {proposal['reason']}")
        lines.append("")
    else:
        lines.append("None pending.")
        lines.append("")

    lines.append("## Accepted, not yet applied")
    lines.append("")
    lines.append(
        "Accepted in Command Center but NOT applied to canonical files — apply manually."
    )
    lines.append("")
    accepted = data["proposals"]["accepted"]
    if accepted:
        for proposal in accepted:
            lines.append(f"- **{proposal['topic']}** — confidence: {proposal['confidence']}")
            lines.append(f"  Proposed: \"{proposal['proposedPositionText']}\"")
            lines.append(f"  Reason: {proposal['reason']}")
        lines.append("")
    else:
        lines.append("None.")
        lines.append("")

    lines.append("## Needs Isaac review")
    lines.append("")
    pending_count = len(pending)
    drafts_count = data["drafts"]["pendingReview"]
    if pending_count == 0 and drafts_count == 0:
        lines.append("Nothing needs Isaac's review right now.")
    else:
        if pending_count:
            lines.append(
                f"- {pending_count} pending proposal(s) awaiting ACCEPT/REJECT — "
                f"see \"Pending proposals\" above."
            )
        if drafts_count:
            lines.append(
                f"- {drafts_count} draft(s) waiting in the approval queue (Status: Draft)."
            )
    lines.append("")

    if data["warnings"]:
        lines.append("## Warnings from the export")
        lines.append("")
        for warning in data["warnings"]:
            lines.append(f"- {warning}")
        lines.append("")

    return "\n".join(lines).rstrip("\n") + "\n"


def render_dry_run_stub(run_when: datetime) -> str:
    lines = [
        f"# Calibration sync — {british_date(run_when)} "
        f"(DRY RUN — NO TOKEN — showing structure only)",
        "",
        "HERMES_API_TOKEN is not set, so this is a structural preview, not a live report.",
        "Set HERMES_API_TOKEN (see hermes/.env.example) and re-run --dry-run for real data.",
        "",
        "## New calibration events",
        "(new CalibrationEvents since the last watermark, grouped by action, would appear here)",
        "",
        "## Pending proposals (awaiting Isaac's ACCEPT/REJECT)",
        "(topic, confidence, proposed text and reason — one entry per pending proposal)",
        "",
        "## Accepted, not yet applied",
        "Accepted in Command Center but NOT applied to canonical files — apply manually.",
        "(topic, confidence, proposed text and reason — one entry per accepted proposal)",
        "",
        "## Needs Isaac review",
        "(pending proposal count + drafts.pendingReview count)",
        "",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Sync Command Center calibration state into the twin repo inbox."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch, validate and print the report to stdout. Never writes state or report files.",
    )
    parser.add_argument(
        "--fixture",
        metavar="PATH",
        help=(
            "Test-only: read the export JSON from PATH instead of making an HTTP "
            "request. Skips the HERMES_API_TOKEN requirement entirely. Not for "
            "production cron use."
        ),
    )
    return parser.parse_args(argv)


def run(argv) -> int:
    args = parse_args(argv)
    now = datetime.now(timezone.utc)

    twin_root = resolve_twin_root()
    state = load_state(state_path(twin_root))
    since_used = state.get("since") or default_since()

    if args.fixture:
        data = read_fixture(args.fixture)
    else:
        token = os.environ.get("HERMES_API_TOKEN")
        if not token:
            if args.dry_run:
                print(render_dry_run_stub(now))
                return 0
            eprint(
                "HERMES_API_TOKEN is required (set it in the environment -- "
                "see hermes/.env.example)"
            )
            return 2
        base_url = os.environ.get("COMMAND_CENTER_URL", DEFAULT_COMMAND_CENTER_URL)
        data = fetch_export(base_url, since_used, token)

    errors = validate_export(data)
    if errors:
        eprint("export validation failed:")
        for error in errors:
            eprint(f"  - {error}")
        return 3

    new_events = [
        event for event in data["events"] if parse_iso(event["createdAt"]) >= parse_iso(since_used)
    ]

    if args.dry_run:
        print(render_report(data, new_events, since_used, now))
        return 0

    standing_hash = compute_standing_hash(data)
    stored_hash = state.get("reportHash")
    if standing_hash == stored_hash and not new_events:
        return 0  # nothing changed -- stay silent

    report = render_report(data, new_events, since_used, now)
    out_path = report_path(twin_root, now)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")

    save_state(
        state_path(twin_root),
        {"since": data["generatedAt"], "reportHash": standing_hash},
    )

    try:
        printable_path = out_path.relative_to(twin_root)
    except ValueError:
        printable_path = out_path
    print(f"calibration report written: {printable_path}")
    return 0


def main(argv) -> int:
    try:
        return run(argv)
    except WorkerError as exc:
        eprint(exc.message)
        return exc.code
    except Exception as exc:  # noqa: BLE001 -- last-resort, cron-friendly
        eprint(f"unexpected error: {exc}")
        return 4


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
