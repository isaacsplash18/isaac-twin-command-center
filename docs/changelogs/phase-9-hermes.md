# Phase 9 (Hermes side) — Telegram Approval Bridge

*Implements the Mac-mini half of `docs/telegram-approval-bridge.md` — §3
(cron/job design, state file), §4 (message format + reply grammar), §7
(security), §8 (failure modes), and steps (b)/(c) of §9. Companion to
`docs/changelogs/phase-9-cc.md` (the Command Center side: the new
`GET /api/hermes/drafts?status=pending` and `POST /api/hermes/decisions`
endpoints this worker calls). This phase produced no app code — everything
lives under `hermes/` for shipment to the `isaacsplash18/hermes-context`
repo on the `calibration-bridge` branch, matching Phase 6's delivery model.*

## Files added

- `hermes/scripts/telegram_approval_bridge.py` — the worker. Python 3,
  standard library only (`argparse`, `json`, `os`, `sys`, `time`, `urllib`,
  `datetime`, `pathlib`), matching every other Hermes worker in this repo.
  Two responsibilities per tick:
  1. **Scan → send.** `GET {COMMAND_CENTER_URL}/api/hermes/drafts?status=
     pending` (Bearer `HERMES_API_TOKEN`); for each `pageId` not already
     confirmed-sent (state file's `sent` map), sends one Telegram message
     (§4 format: platform + short `#id`, humanizer/creator line, excerpt
     capped at `BODY_EXCERPT_CHARS`, reply-grammar hint) to every id in
     `TELEGRAM_CHAT_ID_ALLOWLIST` and records it.
  2. **Drain replies → write back.** Pulls inbound Telegram updates
     (`getUpdates`, cursor persisted in state), parses Isaac's reply
     (`A` / `R [reason]` / `E <full replacement>` — case-insensitive
     leading token, payload after the first space), maps reply → `pageId`
     via the state file's `msgIndex` (reply-to message id), enforces
     `TELEGRAM_CHAT_ID_ALLOWLIST` on every reply before any write-back,
     then `POST {COMMAND_CENTER_URL}/api/hermes/decisions` with
     `{pageId, action, editedText?|reason?, source:"telegram",
     idempotencyKey:"tg:<chat>:<update_id>"}`. A `200` with `noop:true` is
     treated as success ("Already decided in Command Center ✓"); Isaac gets
     a one-line ACK either way.

  State file `~/twin/.telegram-bridge-state.json` (respects `TWIN_ROOT`,
  default two directories up from the script — the same convention as
  Phase 6): `sent` / `msgIndex` / `decided` / `updateCursor` / `retry`, per
  §3's documented shape (with one addition — `sent[pageId]` carries an
  `intended`/`confirmed` pair, not just `msgId`/`sentAt`, so a crash between
  "send" and "state write" is detectable and safely re-sent next tick —
  see Limitations). At-most-once send (skip if `confirmed`), at-least-once
  safety (write an unconfirmed "intended" marker *before* the network call),
  and exactly-once *effect* via the Command Center's status-based no-op.
  5xx/network errors from either side retry with the §8 backoff schedule
  (30s → 1m → 5m, capped) within the tick; a decision that still fails is
  queued in `state.retry[]` and replayed on the next tick (`flush_retry_
  queue`) rather than dropped — Isaac's reply is never silently lost. 4xx
  errors are not retried (the request itself was wrong).

  `--dry-run` prints the messages it *would* send and the decisions it
  *would* POST (plus the nudge ACKs it would send for unmapped/malformed
  replies) — sends nothing, POSTs nothing, writes nothing. Free-text
  content (draft body excerpts, reject reasons, edit replacement text) is
  **redacted to a length marker even in `--dry-run`** — see Security below;
  this is a deliberate, unconditional choice, not a `--dry-run`-only
  behaviour.

  `--fixture <path>` (test-only, mirrors the Phase 6 worker's flag) reads
  `{"drafts": [...], "updates": [...], "seedMsgIndex": {...}}` from a local
  file, bypassing the network entirely for the *read* side of both
  responsibilities, so the whole two-responsibility flow is demonstrable
  offline. `seedMsgIndex` is fixture-only scaffolding — a
  `{"<telegram msg id>": "<pageId>"}` map merged into the in-memory state
  for that run only, standing in for "these drafts were already sent in an
  earlier tick," so a single fixture file can demonstrate reply → `pageId`
  mapping without a prior real send.

  **Gateway isolation (open question O1).** Targets the standard Telegram
  Bot API directly (`sendMessage`, `getUpdates` long-poll cursor) but
  isolates every Telegram HTTP call behind a `TelegramGateway` class
  (`send_message` / `get_updates` / `answer`) — documented at the top of the
  file. If Hermes's real gateway turns out to be a thinner relay, only that
  one class needs to change. `send_message` accepts an optional
  `reply_markup` (inline keyboard) parameter as a forward-compatible seam,
  but this version does not attach one or handle `callback_query` updates —
  see Limitations. The reply-syntax parser (`parse_reply` — `A`/`R`/`E`) is
  the fully-implemented, gateway-agnostic core.

- `hermes/scripts/fixtures/telegram-bridge-sample.json` — the static
  fixture used for this phase's `--dry-run --fixture` verification (below).
  2 new pending drafts (one LinkedIn body long enough to exercise excerpt
  truncation, one short X body), a `seedMsgIndex` standing in for 3
  previously-sent drafts, and 6 inbound Telegram updates covering: approve,
  reject-with-reason, edit, a reply from a non-allowlisted chat (dropped),
  a reply-to an unknown message id (unmapped nudge), and an unrecognised
  leading token (malformed-grammar nudge).
- `hermes/runbooks/telegram-approval-bridge.md` (new) — install/run:
  launchd plist for `com.isaac.twin.telegram-bridge` (`StartInterval 300`,
  a dedicated 5-minute job, not coupled to the 30-minute identity pull), the
  state file, the two responsibilities, the reply grammar, the quiet
  contract, security, exit codes, and a prominent **"Before this runs,
  Isaac must:"** section covering O1 (confirm the gateway) and O2 (the
  numeric chat id).
- this file.

## Files changed

- `hermes/.env.example` — added a new `--- hermes/scripts/
  telegram_approval_bridge.py (Phase 9) ---` section documenting
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID_ALLOWLIST`,
  `TELEGRAM_BRIDGE_POLL_SECONDS` (default 300), `BODY_EXCERPT_CHARS`
  (default 600) — names and comments only, no values. The existing
  `COMMAND_CENTER_URL` / `HERMES_API_TOKEN` / `TWIN_ROOT` entries are
  untouched and reused by this worker.

## New env vars

- `TELEGRAM_BOT_TOKEN` — new. The bridge's own Telegram Bot API token.
  Required for a real (non-dry-run, non-fixture) tick. Never printed or
  logged.
- `TELEGRAM_CHAT_ID_ALLOWLIST` — new. Comma-separated numeric Telegram
  chat/user ids: both the decision-authorisation allowlist and the send
  destination(s) for draft messages. Empty → fails closed (`exit 2` on a
  real run).
- `TELEGRAM_BRIDGE_POLL_SECONDS` — new, optional, default `300`. Documents
  the intended launchd `StartInterval`; also loosely caps the in-request
  `getUpdates` long-poll wait.
- `BODY_EXCERPT_CHARS` — new, optional, default `600`. Caps the draft
  excerpt in the outbound Telegram message.
- `COMMAND_CENTER_URL`, `HERMES_API_TOKEN`, `TWIN_ROOT` — already existed
  (Phase 5/6); reused unchanged by this worker.

No Vercel-side or Notion-side env vars were touched by this (Hermes-side)
phase.

## How verified

All verification was local — no builds, no servers, no real Telegram bot,
no real Command Center deployment, per the task constraints ("dry-run
only").

**1. Compiles cleanly:**

```
$ python3 -m py_compile hermes/scripts/telegram_approval_bridge.py
PY_COMPILE_OK
```

**2. `--dry-run`, no config, no fixture (missing-config stub path):**

```
$ env -u TELEGRAM_BOT_TOKEN -u HERMES_API_TOKEN -u TELEGRAM_CHAT_ID_ALLOWLIST \
    python3 hermes/scripts/telegram_approval_bridge.py --dry-run
=== Telegram approval bridge — DRY RUN (missing config, showing structure only) ===

Not configured yet: TELEGRAM_BOT_TOKEN, HERMES_API_TOKEN, TELEGRAM_CHAT_ID_ALLOWLIST.
Set these in hermes/.env (see hermes/.env.example) and re-run --dry-run,
or pass --fixture <path> to preview against static test data with no config at all.

Once configured, a real tick would:
  1. GET {COMMAND_CENTER_URL}/api/hermes/drafts?status=pending and send one
     Telegram message per pageId not already confirmed-sent.
  2. Drain inbound Telegram replies (A / R <reason> / E <replacement>) and
     POST matching decisions to {COMMAND_CENTER_URL}/api/hermes/decisions.
exit=0
```

**3. Real run, no config (fail-closed path):**

```
$ env -u TELEGRAM_BOT_TOKEN -u HERMES_API_TOKEN -u TELEGRAM_CHAT_ID_ALLOWLIST \
    python3 hermes/scripts/telegram_approval_bridge.py
missing required configuration: TELEGRAM_BOT_TOKEN, HERMES_API_TOKEN, TELEGRAM_CHAT_ID_ALLOWLIST (see hermes/.env.example)
exit=2
```

**4. `--dry-run --fixture` — the full two-responsibility flow, offline, no
config needed except the allowlist (which the reply-drain phase checks
regardless of fixture mode):**

```
$ env -u TELEGRAM_BOT_TOKEN -u HERMES_API_TOKEN \
    TELEGRAM_CHAT_ID_ALLOWLIST=555666777 BODY_EXCERPT_CHARS=120 \
    python3 hermes/scripts/telegram_approval_bridge.py --dry-run \
    --fixture hermes/scripts/fixtures/telegram-bridge-sample.json
drain: reply from non-allowlisted chat_id=111222333 dropped
=== Telegram approval bridge — DRY RUN — 2026-07-07T14:44:41.623521+00:00 ===
(no Telegram messages sent, no decisions POSTed, no state file written)
(free-text content -- draft bodies, reject reasons, edit replacements -- is
 redacted below to a length marker; see module docstring security note)

Would send 2 draft message(s):
  - #ft0001  platform=LinkedIn humanizer=passed via=hermes body=<120+, truncated chars, redacted>
  - #ft0002  platform=X humanizer=unknown via=agent body=<61 chars, redacted>

Would POST 3 decision(s):
  - {'pageId': '#rlier1', 'action': 'approve'}
  - {'pageId': '#rlier2', 'action': 'reject', 'reason': '<33 chars, redacted>'}
  - {'pageId': '#rlier3', 'action': 'edit', 'editedText': '<82 chars, redacted>'}

Would ACK 2 nudge(s) (unmapped/malformed replies):
  - chat=555666777: "I don't recognise that draft — reply to the specific draft message."
  - chat=555666777: 'Reply:  A  ·  R <reason>  ·  E <full replacement>'

exit=0
```

This one run exercises: excerpt truncation (`120+, truncated`, `BODY_
EXCERPT_CHARS=120` against a longer body) vs. a body that fits whole (`61
chars`, no truncation marker); all three reply actions (approve / reject
with a redacted reason / edit with redacted replacement text); the
allowlist check (chat `111222333` dropped, logged by id only, to stderr —
never its message text); an unmapped reply-to (unknown message id →
nudge); and a malformed leading token (`Z` → grammar-reminder nudge). No
Telegram message was sent, no HTTP request was made to the Command Center,
and no file was written — confirmed by `find hermes -name
'*bridge-state*'` returning nothing after the run and `git status`
showing no new/modified files outside what this phase intentionally added.

**5. Fixture validation failure (exit 3):**

```
$ echo '{"drafts":[{"platform":"x"}],"updates":"not-a-list"}' > /tmp/bad-fixture.json
$ python3 hermes/scripts/telegram_approval_bridge.py --dry-run --fixture /tmp/bad-fixture.json
fixture validation failed:
  - drafts[0].pageId: missing required key
  - drafts[0].body: missing required key
  - updates: expected list, got str
exit=3
```

**6. No secrets/content in any output above.** Manually re-read every
transcript in this changelog: no `TELEGRAM_BOT_TOKEN` or `HERMES_API_TOKEN`
value appears anywhere (both were unset for every run, and the code never
interpolates them into a message even when set — see the module
docstring's security note and `_perform_request_with_backoff`, which never
includes the request URL, only a hand-written `what` label, in any raised
error). No draft body, reject reason, or edit replacement text appears —
every occurrence is a `<N chars, redacted>` marker. The one raw value that
*does* appear is a chat id (`111222333`) in the dropped-reply log line,
which is intentional and matches §7 exactly: "allowlist misses are logged
(id only, never the text)."

## Limitations

- **The Bot-API assumption (O1) is unconfirmed.** The whole worker is built
  and tested against the standard Telegram Bot API shape (`getUpdates`
  polling, `sendMessage`). If Hermes's actual Telegram gateway on the mini
  is a thinner relay, only `TelegramGateway` needs to change, but that
  change is real work, not a config flip — nobody should point
  `TELEGRAM_BOT_TOKEN` at a live bot until this is confirmed (see the
  runbook's "Before this runs" section).
- **Inline keyboard buttons are not implemented in v1.** The design allows
  either inline buttons or reply-syntax, deferring to whichever the
  confirmed gateway supports (O1). `TelegramGateway.send_message` accepts a
  `reply_markup` parameter as a seam, but this worker never attaches one,
  and inbound `callback_query` updates are not handled — `drain_replies`
  only looks at `update["message"]`. Reply-syntax (`A`/`R`/`E`) is the
  fully-implemented path, per the design's own framing that it is "the
  robust core that works even without inline buttons." Wiring buttons up
  (which needs a stateful "awaiting text" handshake for EDIT/REJECT) is a
  reasonable fast-follow once O1 is confirmed.
- **`msgIndex` is keyed by Telegram `message_id` alone**, not
  `(chat_id, message_id)`, matching the state shape documented in
  `docs/telegram-approval-bridge.md` §3 verbatim. This is fine for the
  single-recipient case the allowlist is meant for; if
  `TELEGRAM_CHAT_ID_ALLOWLIST` ever holds more than one id, a `message_id`
  collision across chats is theoretically possible. Documented, not fixed,
  since the design's own example shows the single-key shape.
- **§8's "alert line to the next Hermes report / inbox note" for a
  persistently stuck retry is not implemented.** That would mean writing
  into `inbox/…`, which is outside this phase's exact file scope (only
  `hermes/scripts/telegram_approval_bridge.py`, its fixture,
  `hermes/.env.example`, this runbook, and this changelog were in scope).
  Instead, `flush_retry_queue` prints a one-line stderr warning (`pageId` +
  attempt count only, no content) once a queued decision has failed for
  `RETRY_STUCK_WARNING_TICKS` (3) consecutive ticks. This is a strictly
  weaker signal than an inbox note Hermes would proactively surface — worth
  revisiting if a real outage ever exercises this path.
- **The `--dry-run` redaction rule is a deliberate, stricter-than-literal
  reading of §7.** The design's wording ("no draft bodies in logs... never
  written to stdout") doesn't explicitly say whether a debug preview mode
  counts as "logs." This worker treats it as covered — `--dry-run` shows
  message *structure* only, with all free text redacted to a length marker
  — on the theory that an unconditional rule is simpler to verify and
  reason about than one with a carve-out. The trade-off: the pasted
  transcript in §4 above cannot by itself prove the *exact* rendered
  message text matches §4's template character-for-character (only that
  the structural pieces — platform, id, humanizer, via, reply hint — are
  present and correctly ordered). `render_draft_message` (the function that
  builds the real, non-redacted message actually sent to Telegram) was
  read-reviewed against §4's template but not independently executed
  outside the redaction path in this verification pass.
- **No retry/backoff exercised end-to-end.** `_perform_request_with_backoff`
  (30s → 1m → 5m schedule) was code-reviewed but never actually triggered
  in this verification — doing so would mean either a real flaky server or
  sleeping through the real delays, neither of which fits a dry-run-only
  verification pass. The happy-path (`PermanentHTTPError` on 4xx, no retry)
  and the `noop:true` handling were reasoned through but likewise not
  exercised against a live 409-returning endpoint (that requires the
  Command Center side, verified separately per `docs/changelogs/
  phase-9-cc.md`).
- **The exact production install location on the Mac mini**
  (`~/twin/scripts/telegram_approval_bridge.py`) is inferred from the
  Phase 6 precedent, not confirmed against the live filesystem — this phase
  had no access to the actual mini.

## Rollback

- Code: this is a Hermes-side-only, documentation-and-script phase with no
  shared-file edits in the Command Center repo. `git revert` the commit
  that adds `hermes/scripts/telegram_approval_bridge.py`,
  `hermes/scripts/fixtures/telegram-bridge-sample.json`,
  `hermes/.env.example`'s new section, `hermes/runbooks/telegram-approval-
  bridge.md`, and this changelog — nothing else in the Command Center repo
  depends on them.
- Twin repo: rollback is deleting the `calibration-bridge` branch before
  merge (per `docs/hermes-calibration-plan.md` §7). If already merged,
  revert that merge commit and delete the launchd job
  (`launchctl unload ~/Library/LaunchAgents/com.isaac.twin.telegram-
  bridge.plist`) — the worker only ever writes its own state file
  (`.telegram-bridge-state.json`), so deleting the script and that one file
  fully undoes its footprint.
- Env: unset `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID_ALLOWLIST` to make
  every real run exit `2` immediately (fail closed) without needing to
  touch launchd at all. `HERMES_API_TOKEN` unset kills the decisions
  write-back specifically (the Command Center's machine lane already fails
  closed on that, per Phase 5/§7).
