#!/usr/bin/env python3
"""Telegram approval bridge — Hermes (Mac-mini) side, Phase 9.

Companion to `docs/telegram-approval-bridge.md` (the approved design; §3
cron/job design, §4 message format, §7 security, §8 failure modes). Each
invocation is **one tick** with two responsibilities:

  1. **Scan -> send.**  `GET {COMMAND_CENTER_URL}/api/hermes/drafts?status=
     pending` (Bearer `HERMES_API_TOKEN`); for every `pageId` not already
     confirmed-sent in the state file, send one Telegram message and record
     it. At-most-once send per draft; a crash between "send" and "state
     write" re-sends on the next tick (harmless duplicate message) rather
     than silently losing the draft.
  2. **Drain replies -> write back.**  Pull inbound Telegram updates, parse
     Isaac's reply (`A` / `R [reason]` / `E <full replacement>`), map the
     reply to a `pageId` via the state file's msg-id index, enforce
     `TELEGRAM_CHAT_ID_ALLOWLIST` on every reply, then `POST
     {COMMAND_CENTER_URL}/api/hermes/decisions`. A `200` with `noop:true`
     ("someone already decided this") is treated as success, not failure —
     see docs/telegram-approval-bridge.md §2/§8.

Intended to run from a dedicated 5-minute launchd job
(`com.isaac.twin.telegram-bridge`, `StartInterval 300`) — see
`hermes/runbooks/telegram-approval-bridge.md`. Like
`sync_command_center_calibration.py` (Phase 6), it is quiet by default: a
normal tick with nothing new to send and nothing new to decide prints
nothing and exits 0.

Python 3, standard library only (argparse, json, os, sys, time, urllib,
datetime, pathlib) — no pip dependencies, matching every other Hermes
worker in this repo.

--------------------------------------------------------------------------
Gateway isolation (design open question O1)
--------------------------------------------------------------------------
This worker targets the standard Telegram Bot API
(https://core.telegram.org/bots/api) directly: `sendMessage` to push a
draft, `getUpdates` (long-poll cursor) to drain replies. It is possible
Hermes's actual Telegram gateway on the Mac mini turns out to be a thinner
relay instead (send-only + plain replies delivered some other way) — the
design doc flags this as unresolved (O1). ALL Telegram HTTP calls are
therefore isolated behind the `TelegramGateway` class below (`send_message`,
`get_updates`, `answer`). If the real gateway is not the Bot API, only this
one class needs to change; nothing else in the file assumes HTTP specifics
about Telegram. The reply-syntax parser (`parse_reply` — `A`/`R`/`E`) is the
robust core that works with any gateway capable of delivering Isaac's
plain-text replies back to this worker, which is why it — not inline
keyboard buttons — is the fully-implemented path in this version. The
gateway's `send_message` accepts an optional `reply_markup` (Telegram inline
keyboard) parameter as a forward-compatible seam, but this worker does not
yet attach one or handle `callback_query` updates: doing that well needs a
stateful "awaiting text" handshake for EDIT/REJECT that isn't worth building
against an unconfirmed gateway capability. Confirm O1, then wire buttons up
as a fast-follow.

--------------------------------------------------------------------------
Environment
--------------------------------------------------------------------------
    COMMAND_CENTER_URL          Base URL of the Command Center deployment.
                                 Default: https://isaac-twin-command-center.vercel.app
    HERMES_API_TOKEN             Bearer token for the machine lane
                                 (GET /api/hermes/drafts, POST /api/hermes/
                                 decisions). Required for a real (non-dry-
                                 run, non-fixture) tick.
    TWIN_ROOT                    Override for the twin repo root (state file
                                 lives at $TWIN_ROOT/.telegram-bridge-state.
                                 json). Defaults to two directories up from
                                 this file, correct once shipped to
                                 <twin repo>/scripts/telegram_approval_bridge.py.
    TELEGRAM_BOT_TOKEN            Telegram Bot API token. Required for a real
                                 tick. NEVER printed or logged.
    TELEGRAM_CHAT_ID_ALLOWLIST     Comma-separated numeric Telegram chat/user
                                 ids authorised to decide (and the
                                 destination(s) drafts are sent to). Required
                                 for a real tick — an empty allowlist means
                                 nobody can be sent to or trusted, so the
                                 worker fails closed.
    TELEGRAM_BRIDGE_POLL_SECONDS   Informational: the launchd `StartInterval`
                                 this worker is meant to run under (default
                                 300). Also loosely caps the in-request
                                 getUpdates long-poll wait so one invocation
                                 returns quickly regardless of the configured
                                 cadence.
    BODY_EXCERPT_CHARS            Max characters of a draft body included in
                                 the outbound Telegram message (default 600).

--------------------------------------------------------------------------
Security (docs/telegram-approval-bridge.md §7) — verify in any output
--------------------------------------------------------------------------
    - TELEGRAM_BOT_TOKEN and HERMES_API_TOKEN are never printed or logged,
      in any mode, including --dry-run.
    - Draft bodies, edit replacement text, and reject reasons are NEVER
      written to stdout/stderr, in ANY mode — including --dry-run. A real
      (production) tick only ever logs pageId + action + outcome. --dry-run
      previews message *structure* (platform, short id, humanizer, via,
      reply-grammar hint, decision action) but replaces free-text content
      with a redacted `<N chars, redacted>` marker rather than the text
      itself. This is a deliberate, unconditional rule (no "debug carve-
      out") so §7 holds regardless of invocation mode. The Telegram message
      that is actually SENT to Isaac's phone does of course carry the real
      excerpt — that transient appearance in the Telegram thread is the
      whole point of the bridge (§7: "it lives in Notion ... and,
      transiently, in the Telegram thread") — the rule is specifically
      about this worker's own stdout/stderr/logs/state file.
    - Every inbound reply is checked against TELEGRAM_CHAT_ID_ALLOWLIST
      before any decision is POSTed. A non-allowlisted chat id is logged
      (the id only, never the message text) and dropped.
    - Fails closed: missing HERMES_API_TOKEN / TELEGRAM_BOT_TOKEN /
      TELEGRAM_CHAT_ID_ALLOWLIST disables the relevant half of the bridge
      for a real run (exit 2) rather than silently no-op'ing in a way that
      could look like a delivered draft.

--------------------------------------------------------------------------
Usage
--------------------------------------------------------------------------
    python3 telegram_approval_bridge.py
    python3 telegram_approval_bridge.py --dry-run
    python3 telegram_approval_bridge.py --dry-run --fixture path/to/fixture.json

--fixture is test-only (mirrors sync_command_center_calibration.py): it
reads {"drafts": [...], "updates": [...], "seedMsgIndex": {...}} from a
local file instead of calling the network for the *read* side of each
responsibility (GET /api/hermes/drafts, Telegram getUpdates), so the whole
two-responsibility flow can be demonstrated with no live Telegram bot or
Command Center. `seedMsgIndex` is fixture-only scaffolding: a
`{"<telegram msg id>": "<pageId>"}` map merged into the in-memory state for
this run only, standing in for "these drafts were already sent in an
earlier tick" so a single fixture file can demonstrate reply -> pageId
mapping without a prior real send. Combined with --dry-run, nothing is sent,
POSTed, or written to disk.

--------------------------------------------------------------------------
Exit codes
--------------------------------------------------------------------------
    0  Success. Sent/decided something and said so tersely, or nothing was
       new and the run was silent.
    2  Required live config missing (TELEGRAM_BOT_TOKEN / HERMES_API_TOKEN /
       TELEGRAM_CHAT_ID_ALLOWLIST) for a real, non-fixture run.
    3  The --fixture file failed structural validation. Nothing was written.
    4  A network error, timeout, malformed JSON, or unexpected exception.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_COMMAND_CENTER_URL = "https://isaac-twin-command-center.vercel.app"
REQUEST_TIMEOUT_SECONDS = 15
TELEGRAM_API_TIMEOUT_SECONDS = 15
# 30s -> 1m -> 5m capped, per docs/telegram-approval-bridge.md §8.
BACKOFF_DELAYS_SECONDS = (30, 60, 300)
RETRY_STUCK_WARNING_TICKS = 3
DEFAULT_BODY_EXCERPT_CHARS = 600
DEFAULT_POLL_SECONDS = 300
# Telegram getUpdates long-poll wait, capped low so one script invocation
# (a single cron/launchd tick) returns quickly regardless of the configured
# TELEGRAM_BRIDGE_POLL_SECONDS, which governs the interval *between*
# invocations, not the in-request wait.
GETUPDATES_LONGPOLL_TIMEOUT_CAP = 25

STATE_RELATIVE_PATH = Path(".telegram-bridge-state.json")

PLATFORM_LABELS = {
    "x": "X",
    "linkedin": "LinkedIn",
    "ig-story": "IG Story",
    "ig_story": "IG Story",
    "ig-carousel": "IG Carousel",
    "ig_carousel": "IG Carousel",
}

DRAFT_FIXTURE_REQUIRED_FIELDS = ("pageId", "platform", "body")


class WorkerError(Exception):
    """A handled, cron-friendly failure: one-line message, explicit exit code."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class TransientHTTPError(Exception):
    """5xx / network / malformed-response — retryable within the backoff schedule."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class PermanentHTTPError(Exception):
    """4xx — the request itself was rejected; retrying won't help."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def eprint(message: str) -> None:
    print(message, file=sys.stderr)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------------
# Paths / twin root / state file
# --------------------------------------------------------------------------


def resolve_twin_root() -> Path:
    override = os.environ.get("TWIN_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    # This file is expected to live at <twin repo>/scripts/<this file>.py.
    return Path(__file__).resolve().parent.parent


def state_path(twin_root: Path) -> Path:
    return twin_root / STATE_RELATIVE_PATH


def default_state() -> dict:
    return {"sent": {}, "msgIndex": {}, "decided": {}, "updateCursor": None, "retry": []}


def load_state(path: Path) -> dict:
    state = default_state()
    if not path.exists():
        return state
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        if isinstance(data, dict):
            for key in state:
                if key in data:
                    state[key] = data[key]
    except (OSError, json.JSONDecodeError):
        # A corrupt state file should not crash a cron tick -- treat it as
        # "first run" rather than traceback-spamming a cron log.
        pass
    return state


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# Env helpers
# --------------------------------------------------------------------------


def get_env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def get_allowlist() -> set:
    raw = os.environ.get("TELEGRAM_CHAT_ID_ALLOWLIST", "")
    return {part.strip() for part in raw.split(",") if part.strip()}


def numeric_chat_ids(allowlist) -> list:
    ids = []
    for value in allowlist:
        try:
            ids.append(int(value))
        except ValueError:
            eprint(f"config: TELEGRAM_CHAT_ID_ALLOWLIST entry {value!r} is not numeric, skipped")
    return ids


# --------------------------------------------------------------------------
# Reply grammar (docs/telegram-approval-bridge.md §4)
# --------------------------------------------------------------------------


def parse_reply(text):
    """Parse Isaac's reply text. Returns (action, payload) or None if
    unparseable. `action` is one of "approve" / "reject" / "edit". Grammar
    is case-insensitive on the leading token; everything after the first
    space is the payload.
    """
    if not isinstance(text, str):
        return None
    stripped = text.strip()
    if not stripped:
        return None
    parts = stripped.split(" ", 1)
    token = parts[0].strip().upper()
    payload = parts[1].strip() if len(parts) > 1 else ""
    if token == "A":
        return ("approve", "")
    if token == "R":
        return ("reject", payload)
    if token == "E":
        if not payload:
            return None  # malformed: E with no replacement text
        return ("edit", payload)
    return None


# --------------------------------------------------------------------------
# Message rendering (docs/telegram-approval-bridge.md §4)
# --------------------------------------------------------------------------


def platform_label(raw: str) -> str:
    return PLATFORM_LABELS.get((raw or "").strip().lower(), raw or "unknown")


def render_draft_message(draft: dict, excerpt_chars: int) -> str:
    """The real message text sent to Telegram. Contains the draft excerpt --
    that is the point of the bridge. Never passed to eprint()/print() in
    this file; see the security note in the module docstring.
    """
    label = platform_label(draft.get("platform", ""))
    short_id = (draft.get("pageId") or "")[-6:]
    humanizer = draft.get("humanizer") or "unknown"
    created_by = draft.get("createdBy") or "unknown"
    body = draft.get("body") or ""
    excerpt = body[:excerpt_chars]
    if len(body) > excerpt_chars:
        excerpt = excerpt.rstrip() + "…"
    lines = [
        f"\U0001F4DD DRAFT — {label} · #{short_id}",
        f"Humanizer: {humanizer} · via {created_by}",
        "",
        f"“{excerpt}”",
        "",
        "Reply:  A  ·  R <reason>  ·  E <full replacement>",
    ]
    return "\n".join(lines)


def redact_draft_preview(draft: dict, excerpt_chars: int) -> str:
    """A --dry-run-safe summary of a draft message: structure only, body
    content replaced with a length marker. See module docstring security
    note -- this is unconditional, not just for --dry-run's benefit.
    """
    label = platform_label(draft.get("platform", ""))
    humanizer = draft.get("humanizer") or "unknown"
    created_by = draft.get("createdBy") or "unknown"
    body = draft.get("body") or ""
    truncated = len(body) > excerpt_chars
    shown = min(len(body), excerpt_chars)
    suffix = "+, truncated" if truncated else ""
    return f"platform={label} humanizer={humanizer} via={created_by} body=<{shown}{suffix} chars, redacted>"


def redact_decision(decision: dict) -> dict:
    out = {"pageId": "#" + (decision.get("pageId") or "??????")[-6:], "action": decision.get("action")}
    if "reason" in decision:
        out["reason"] = f"<{len(decision['reason'])} chars, redacted>"
    if "editedText" in decision:
        out["editedText"] = f"<{len(decision['editedText'])} chars, redacted>"
    return out


def ack_text_for(action: str, noop: bool, page_id: str) -> str:
    short = (page_id or "")[-6:] or "??????"
    if noop:
        return f"Already decided in Command Center ✓ #{short}"
    labels = {"approve": "Approved", "reject": "Rejected", "edit": "Edited + approved"}
    return f"{labels.get(action, 'Done')} ✓ #{short}"


# --------------------------------------------------------------------------
# HTTP (Command Center machine lane + Telegram Bot API), shared backoff
# --------------------------------------------------------------------------


def _perform_request_with_backoff(request: "urllib.request.Request", what: str) -> dict:
    """GET/POST with the §8 backoff schedule (30s -> 1m -> 5m capped) on 5xx
    / network / malformed-JSON errors. Raises PermanentHTTPError immediately
    on 4xx (retrying a rejected request never helps). Never includes the
    request URL (which may embed a bot token) in any raised message.
    """
    last_exc = None
    for attempt, _ in enumerate((0,) + BACKOFF_DELAYS_SECONDS):
        if attempt > 0:
            time.sleep(BACKOFF_DELAYS_SECONDS[attempt - 1])
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                raw = resp.read()
            if not raw:
                return {}
            return json.loads(raw)
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500:
                raise PermanentHTTPError(exc.code, f"{what}: HTTP {exc.code} {exc.reason}") from None
            last_exc = TransientHTTPError(exc.code, f"{what}: HTTP {exc.code} {exc.reason}")
        except urllib.error.URLError as exc:
            last_exc = TransientHTTPError(0, f"{what}: {exc.reason}")
        except TimeoutError:
            last_exc = TransientHTTPError(0, f"{what}: timed out after {REQUEST_TIMEOUT_SECONDS}s")
        except json.JSONDecodeError as exc:
            last_exc = TransientHTTPError(0, f"{what}: invalid JSON response: {exc}")
    raise last_exc


def fetch_pending_drafts(base_url: str, token: str):
    url = f"{base_url.rstrip('/')}/api/hermes/drafts?status=pending"
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}
    )
    return _perform_request_with_backoff(request, "GET /api/hermes/drafts")


def post_decision(base_url: str, token: str, decision: dict) -> dict:
    url = f"{base_url.rstrip('/')}/api/hermes/decisions"
    body = json.dumps(decision).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    return _perform_request_with_backoff(request, "POST /api/hermes/decisions")


class TelegramGateway:
    """Thin adapter over the Telegram Bot API HTTP surface this worker
    actually uses. See the module docstring's "Gateway isolation" section --
    this class is the entire seam that would need to change if Hermes's real
    gateway is not the Bot API (design open question O1).
    """

    def __init__(self, bot_token: str, timeout: int = TELEGRAM_API_TIMEOUT_SECONDS):
        self._token = bot_token
        self._timeout = timeout
        self._base = f"https://api.telegram.org/bot{bot_token}"

    def _call(self, method: str, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self._base}/{method}",
            data=data,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        result = _perform_request_with_backoff(request, f"telegram.{method}")
        if not result.get("ok", False):
            raise TransientHTTPError(
                0, f"telegram.{method}: ok=false ({result.get('description', 'no description')})"
            )
        return result.get("result")

    def send_message(self, chat_id, text: str, reply_markup=None) -> int:
        """Send a message, return the new Telegram message_id. `reply_markup`
        (an inline keyboard dict) is accepted as a forward-compatible seam
        for O1 but unused by this worker in v1 -- see module docstring.
        """
        payload = {"chat_id": chat_id, "text": text}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        result = self._call("sendMessage", payload)
        return result["message_id"]

    def get_updates(self, offset=None, timeout: int = 0) -> list:
        payload = {"timeout": timeout}
        if offset is not None:
            payload["offset"] = offset
        result = self._call("getUpdates", payload)
        return result or []

    def answer(self, chat_id, text: str) -> None:
        self._call("sendMessage", {"chat_id": chat_id, "text": text})


# --------------------------------------------------------------------------
# Responsibility 1 — scan -> send
# --------------------------------------------------------------------------


def scan_and_send(gateway, base_url, cc_token, state, excerpt_chars, dry_run, state_file, fixture_drafts=None):
    """Returns (preview, sent_count). `preview` is only populated in
    --dry-run (redacted draft summaries); `sent_count` is the number of
    drafts newly confirmed-sent this tick (real runs only) -- used to decide
    whether this tick has anything worth a one-line stdout report.
    """
    if fixture_drafts is not None:
        drafts = fixture_drafts
    else:
        if not cc_token:
            return [], 0
        try:
            payload = fetch_pending_drafts(base_url, cc_token)
        except PermanentHTTPError as exc:
            eprint(f"scan: {exc.message}")
            return [], 0
        except TransientHTTPError as exc:
            eprint(f"scan: {exc.message} -- giving up for this tick, will retry next tick")
            return [], 0
        if isinstance(payload, list):
            drafts = payload
        elif isinstance(payload, dict):
            drafts = payload.get("drafts")
        else:
            drafts = None
        if not isinstance(drafts, list):
            eprint("scan: unexpected /api/hermes/drafts response shape (expected a list or {\"drafts\": [...]})")
            return [], 0

    sent_state = state.setdefault("sent", {})
    msg_index = state.setdefault("msgIndex", {})
    preview = []
    sent_count = 0

    for draft in drafts:
        if not isinstance(draft, dict):
            continue
        page_id = draft.get("pageId")
        if not page_id:
            continue
        entry = sent_state.get(page_id)
        if entry and entry.get("confirmed"):
            continue  # at-most-once send per draft

        if dry_run:
            preview.append((page_id, redact_draft_preview(draft, excerpt_chars)))
            continue

        if gateway is None:
            continue  # no bot token configured -- nothing to send with

        now_iso = iso_now()
        # At-least-once send: mark "intended" and persist BEFORE the network
        # call, so a crash between send and state-write re-sends next tick
        # (a harmless duplicate message) rather than silently dropping the
        # draft -- docs/telegram-approval-bridge.md §3.
        sent_state[page_id] = {"intended": True, "confirmed": False, "sentAt": now_iso}
        if state_file is not None:
            save_state(state_file, state)

        text = render_draft_message(draft, excerpt_chars)
        sent_ok = False
        last_msg_id = None
        for chat_id in numeric_chat_ids(get_allowlist()):
            try:
                last_msg_id = gateway.send_message(chat_id, text)
                msg_index[str(last_msg_id)] = page_id
                sent_ok = True
            except (TransientHTTPError, PermanentHTTPError) as exc:
                eprint(f"send pageId=#{page_id[-6:]} chat={chat_id}: {exc.message}")

        if sent_ok:
            sent_state[page_id] = {"msgId": last_msg_id, "sentAt": now_iso, "confirmed": True}
            sent_count += 1
        # else: left as intended/unconfirmed -- scanned and re-sent next tick

    return preview, sent_count


# --------------------------------------------------------------------------
# Responsibility 2 — drain replies -> write back
# --------------------------------------------------------------------------


def _ack(gateway, chat_id, text) -> None:
    if gateway is None:
        return
    try:
        gateway.answer(chat_id, text)
    except (TransientHTTPError, PermanentHTTPError) as exc:
        eprint(f"ack chat={chat_id}: {exc.message}")


def _ack_or_collect(gateway, chat_id, text, dry_run, would_ack) -> None:
    if dry_run:
        would_ack.append((chat_id, text))
        return
    _ack(gateway, chat_id, text)


def _apply_decision(gateway, base_url, cc_token, chat_id, decision, decided_state, retry_queue) -> bool:
    """Returns True iff the decision was applied (200, noop or not) this call."""
    page_id = decision["pageId"]
    if not cc_token:
        eprint(f"decision pageId=#{page_id[-6:]}: HERMES_API_TOKEN not set, queued for retry")
        retry_queue.append({"decision": decision, "chatId": chat_id, "attempts": 0})
        _ack(gateway, chat_id, "Got it — queued, will apply once configured.")
        return False
    try:
        result = post_decision(base_url, cc_token, decision)
    except PermanentHTTPError as exc:
        eprint(f"decision pageId=#{page_id[-6:]} action={decision['action']}: {exc.message} -- dropped, not retried")
        _ack(gateway, chat_id, "Sorry — that didn't go through. Try again or use the web UI.")
        return False
    except TransientHTTPError as exc:
        eprint(f"decision pageId=#{page_id[-6:]} action={decision['action']}: {exc.message} -- queued for retry")
        retry_queue.append({"decision": decision, "chatId": chat_id, "attempts": 0})
        _ack(gateway, chat_id, "Got it — queued, will apply shortly.")
        return False

    decided_state[page_id] = {"action": decision["action"], "at": iso_now()}
    _ack(gateway, chat_id, ack_text_for(decision["action"], bool(result.get("noop")), page_id))
    return True


def flush_retry_queue(gateway, base_url, cc_token, state) -> None:
    """Best-effort replay of decisions that failed write-back on a previous
    tick (docs/telegram-approval-bridge.md §8, row 1/3). Isaac's reply is
    never dropped on a transient Command Center failure -- it stays queued
    here until it succeeds (200, noop or not) or is permanently rejected
    (4xx, dropped -- the request itself was wrong, not the timing).
    """
    retry_queue = state.get("retry") or []
    if not retry_queue:
        return
    decided_state = state.setdefault("decided", {})
    still_pending = []
    for entry in retry_queue:
        decision = entry.get("decision") or {}
        chat_id = entry.get("chatId")
        page_id = decision.get("pageId") or "??????"
        try:
            result = post_decision(base_url, cc_token, decision)
        except PermanentHTTPError as exc:
            eprint(f"retry-flush pageId=#{page_id[-6:]}: {exc.message} -- dropped")
            continue
        except TransientHTTPError as exc:
            attempts = entry.get("attempts", 0) + 1
            entry["attempts"] = attempts
            if attempts >= RETRY_STUCK_WARNING_TICKS:
                eprint(f"retry-flush pageId=#{page_id[-6:]}: still failing after {attempts} tick(s) -- {exc.message}")
            still_pending.append(entry)
            continue
        decided_state[page_id] = {"action": decision.get("action"), "at": iso_now()}
        if chat_id is not None:
            _ack(gateway, chat_id, ack_text_for(decision.get("action", ""), bool(result.get("noop")), page_id))
    state["retry"] = still_pending


def drain_replies(gateway, base_url, cc_token, state, allowlist, poll_timeout, dry_run, fixture_updates=None):
    """Returns (would_post, would_ack, decided_count). The first two are
    only populated in --dry-run; `decided_count` is the number of decisions
    newly applied this tick (real runs only).
    """
    if fixture_updates is not None:
        updates = fixture_updates
    else:
        if gateway is None:
            return [], [], 0
        try:
            updates = gateway.get_updates(offset=state.get("updateCursor"), timeout=poll_timeout)
        except PermanentHTTPError as exc:
            eprint(f"drain: {exc.message}")
            return [], [], 0
        except TransientHTTPError as exc:
            eprint(f"drain: {exc.message} -- giving up for this tick, will retry next tick")
            return [], [], 0

    decided_state = state.setdefault("decided", {})
    msg_index = state.get("msgIndex", {})
    retry_queue = state.setdefault("retry", [])
    would_post = []
    would_ack = []
    decided_count = 0

    for update in updates:
        if not isinstance(update, dict):
            continue
        update_id = update.get("update_id")
        if update_id is not None and not dry_run:
            cursor_next = update_id + 1
            current = state.get("updateCursor")
            if current is None or cursor_next > current:
                state["updateCursor"] = cursor_next

        message = update.get("message")
        if not isinstance(message, dict):
            # edited_message / channel_post / callback_query -- not handled
            # in v1 (reply-syntax is the supported path; see module docstring).
            continue

        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        text = message.get("text")
        reply_to = message.get("reply_to_message") or {}
        reply_to_msg_id = reply_to.get("message_id")

        if chat_id is None or str(chat_id) not in allowlist:
            eprint(f"drain: reply from non-allowlisted chat_id={chat_id!r} dropped")
            continue

        if reply_to_msg_id is None:
            _ack_or_collect(
                gateway, chat_id,
                "Reply to the specific draft message so I know which one you mean.",
                dry_run, would_ack,
            )
            continue

        page_id = msg_index.get(str(reply_to_msg_id))
        if page_id is None:
            _ack_or_collect(
                gateway, chat_id,
                "I don't recognise that draft — reply to the specific draft message.",
                dry_run, would_ack,
            )
            continue

        parsed = parse_reply(text)
        if parsed is None:
            _ack_or_collect(
                gateway, chat_id,
                "Reply:  A  ·  R <reason>  ·  E <full replacement>",
                dry_run, would_ack,
            )
            continue

        action, payload_text = parsed
        decision = {
            "pageId": page_id,
            "action": action,
            "source": "telegram",
            "idempotencyKey": f"tg:{chat_id}:{update_id}",
        }
        if action == "reject" and payload_text:
            decision["reason"] = payload_text
        if action == "edit":
            decision["editedText"] = payload_text

        if dry_run:
            would_post.append(redact_decision(decision))
            continue

        if _apply_decision(gateway, base_url, cc_token, chat_id, decision, decided_state, retry_queue):
            decided_count += 1

    return would_post, would_ack, decided_count


# --------------------------------------------------------------------------
# Fixture (test-only)
# --------------------------------------------------------------------------


def read_fixture(path_str: str) -> dict:
    path = Path(path_str).expanduser()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise WorkerError(4, f"could not read fixture file {path}: {exc}") from None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WorkerError(4, f"fixture file {path} is not valid JSON: {exc}") from None
    if not isinstance(data, dict):
        raise WorkerError(
            3, f"fixture file must be a JSON object with \"drafts\"/\"updates\" keys, got {type(data).__name__}"
        )
    return data


def validate_fixture(data: dict) -> list:
    errors = []
    drafts = data.get("drafts", [])
    if not isinstance(drafts, list):
        errors.append(f"drafts: expected list, got {type(drafts).__name__}")
    else:
        for idx, item in enumerate(drafts):
            path = f"drafts[{idx}]"
            if not isinstance(item, dict):
                errors.append(f"{path}: expected object, got {type(item).__name__}")
                continue
            for name in DRAFT_FIXTURE_REQUIRED_FIELDS:
                if name not in item:
                    errors.append(f"{path}.{name}: missing required key")
                elif not isinstance(item[name], str):
                    errors.append(f"{path}.{name}: expected str, got {type(item[name]).__name__}")

    updates = data.get("updates", [])
    if not isinstance(updates, list):
        errors.append(f"updates: expected list, got {type(updates).__name__}")
    else:
        for idx, item in enumerate(updates):
            path = f"updates[{idx}]"
            if not isinstance(item, dict):
                errors.append(f"{path}: expected object, got {type(item).__name__}")
                continue
            if "update_id" not in item:
                errors.append(f"{path}.update_id: missing required key")

    seed_msg_index = data.get("seedMsgIndex", {})
    if seed_msg_index and not isinstance(seed_msg_index, dict):
        errors.append(f"seedMsgIndex: expected object, got {type(seed_msg_index).__name__}")

    return errors


# --------------------------------------------------------------------------
# Dry-run rendering
# --------------------------------------------------------------------------


def render_missing_config_stub(bot_token, cc_token, allowlist) -> str:
    missing = []
    if not bot_token:
        missing.append("TELEGRAM_BOT_TOKEN")
    if not cc_token:
        missing.append("HERMES_API_TOKEN")
    if not allowlist:
        missing.append("TELEGRAM_CHAT_ID_ALLOWLIST")
    lines = [
        "=== Telegram approval bridge — DRY RUN (missing config, showing structure only) ===",
        "",
        "Not configured yet: " + ", ".join(missing) + ".",
        "Set these in hermes/.env (see hermes/.env.example) and re-run --dry-run,",
        "or pass --fixture <path> to preview against static test data with no config at all.",
        "",
        "Once configured, a real tick would:",
        "  1. GET {COMMAND_CENTER_URL}/api/hermes/drafts?status=pending and send one",
        "     Telegram message per pageId not already confirmed-sent.",
        "  2. Drain inbound Telegram replies (A / R <reason> / E <replacement>) and",
        "     POST matching decisions to {COMMAND_CENTER_URL}/api/hermes/decisions.",
    ]
    return "\n".join(lines)


def render_dry_run_report(would_send, would_post, would_ack, now) -> str:
    lines = [
        f"=== Telegram approval bridge — DRY RUN — {now.isoformat()} ===",
        "(no Telegram messages sent, no decisions POSTed, no state file written)",
        "(free-text content -- draft bodies, reject reasons, edit replacements -- is",
        " redacted below to a length marker; see module docstring security note)",
        "",
        f"Would send {len(would_send)} draft message(s):",
    ]
    if would_send:
        for page_id, preview in would_send:
            lines.append(f"  - #{page_id[-6:]}  {preview}")
    else:
        lines.append("  (none — nothing new since last sent, or no pending drafts)")
    lines.append("")
    lines.append(f"Would POST {len(would_post)} decision(s):")
    if would_post:
        for decision in would_post:
            lines.append(f"  - {decision}")
    else:
        lines.append("  (none — no mappable/authorised replies)")
    lines.append("")
    lines.append(f"Would ACK {len(would_ack)} nudge(s) (unmapped/malformed replies):")
    if would_ack:
        for chat_id, text in would_ack:
            lines.append(f"  - chat={chat_id}: {text!r}")
    else:
        lines.append("  (none)")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Telegram approval bridge -- scan pending drafts to Telegram, drain replies back to decisions."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be sent/POSTed instead of doing it. Never writes the state file.",
    )
    parser.add_argument(
        "--fixture",
        metavar="PATH",
        help=(
            "Test-only: read {\"drafts\": [...], \"updates\": [...], \"seedMsgIndex\": {...}} "
            "from PATH instead of calling the network for the read side of each responsibility. "
            "Not part of the production cron path."
        ),
    )
    return parser.parse_args(argv)


def run(argv) -> int:
    args = parse_args(argv)
    now = datetime.now(timezone.utc)

    twin_root = resolve_twin_root()
    st_path = state_path(twin_root)
    state = load_state(st_path)

    excerpt_chars = get_env_int("BODY_EXCERPT_CHARS", DEFAULT_BODY_EXCERPT_CHARS)
    poll_seconds = get_env_int("TELEGRAM_BRIDGE_POLL_SECONDS", DEFAULT_POLL_SECONDS)
    getupdates_timeout = min(poll_seconds, GETUPDATES_LONGPOLL_TIMEOUT_CAP) if poll_seconds > 0 else 0

    fixture_data = None
    if args.fixture:
        fixture_data = read_fixture(args.fixture)
        fixture_errors = validate_fixture(fixture_data)
        if fixture_errors:
            eprint("fixture validation failed:")
            for error in fixture_errors:
                eprint(f"  - {error}")
            return 3
        seed_msg_index = fixture_data.get("seedMsgIndex")
        if isinstance(seed_msg_index, dict):
            # Fixture-only scaffolding: pretend these msgId -> pageId
            # mappings already exist, as if an earlier tick's scan-and-send
            # had already run. In-memory only for this run; never persisted
            # (this run never calls save_state unless --dry-run is absent,
            # and even then only real mutations from this tick are written).
            state.setdefault("msgIndex", {}).update(seed_msg_index)

    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")
    cc_token = os.environ.get("HERMES_API_TOKEN")
    allowlist = get_allowlist()
    base_url = os.environ.get("COMMAND_CENTER_URL", DEFAULT_COMMAND_CENTER_URL)
    have_live_config = bool(bot_token) and bool(cc_token) and bool(allowlist)

    if fixture_data is None and not have_live_config:
        if args.dry_run:
            print(render_missing_config_stub(bot_token, cc_token, allowlist))
            return 0
        missing = []
        if not bot_token:
            missing.append("TELEGRAM_BOT_TOKEN")
        if not cc_token:
            missing.append("HERMES_API_TOKEN")
        if not allowlist:
            missing.append("TELEGRAM_CHAT_ID_ALLOWLIST")
        eprint("missing required configuration: " + ", ".join(missing) + " (see hermes/.env.example)")
        return 2

    gateway = TelegramGateway(bot_token) if bot_token else None

    if not args.dry_run and gateway is not None and cc_token:
        flush_retry_queue(gateway, base_url, cc_token, state)

    fixture_drafts = fixture_data.get("drafts") if fixture_data is not None else None
    fixture_updates = fixture_data.get("updates") if fixture_data is not None else None

    would_send, sent_count = scan_and_send(
        gateway, base_url, cc_token, state, excerpt_chars, args.dry_run, st_path,
        fixture_drafts=fixture_drafts,
    )
    would_post, would_ack, decided_count = drain_replies(
        gateway, base_url, cc_token, state, allowlist, getupdates_timeout, args.dry_run,
        fixture_updates=fixture_updates,
    )

    if args.dry_run:
        print(render_dry_run_report(would_send, would_post, would_ack, now))
        return 0

    save_state(st_path, state)

    # Quiet by default (docs/telegram-approval-bridge.md §3): print exactly
    # one terse line -- pageId + action + outcome only, never body/reason/
    # editedText content -- when this tick actually sent or decided
    # something; otherwise stay silent, matching
    # sync_command_center_calibration.py's "no stdout when nothing changed"
    # contract (Phase 6).
    if sent_count or decided_count:
        print(f"telegram bridge: sent {sent_count} draft(s), applied {decided_count} decision(s)")
    return 0


def main(argv) -> int:
    try:
        return run(argv)
    except WorkerError as exc:
        eprint(exc.message)
        return exc.code
    except Exception as exc:  # noqa: BLE001 -- last-resort, cron-friendly
        # urllib's URLError/HTTPError __str__ never includes the request URL
        # (which could embed the bot token), and TransientHTTPError /
        # PermanentHTTPError messages are hand-written without it -- so this
        # is safe even as a catch-all.
        eprint(f"unexpected error: {exc}")
        return 4


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
