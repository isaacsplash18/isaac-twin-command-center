<!--
  Runbook for hermes/scripts/telegram_approval_bridge.py (Phase 9). Lives
  under hermes/runbooks/ for shipment to the twin repo alongside the worker
  itself, the same way hermes/runbooks/hermes-twin-runtime-additions.md
  ships the Phase 6 calibration-sync section. Source: hermes/ in the
  Command Center repo, Phase 9 (docs/telegram-approval-bridge.md).
-->

# Telegram approval bridge

> **⏸ PAUSED (8 July 2026):** do not install or schedule this worker — Isaac
> moved all draft approvals into the Command Center, which is now the only
> draft review surface. Kept for possible future reactivation. The
> calibration sync worker is NOT affected and should run.

Companion to `docs/telegram-approval-bridge.md` (the approved design). This
worker closes the loop: it pushes pending drafts from the Command Center to
Isaac on Telegram, and writes his `A` / `R <reason>` / `E <replacement>`
replies back as decisions.

## Before this runs, Isaac must:

1. **(O1) Confirm the Telegram gateway.** This worker is built against the
   standard Telegram **Bot API** (`api.telegram.org/bot<token>/...` —
   `sendMessage` to push a draft, `getUpdates` to drain replies). Confirm
   that is what Hermes's actual Telegram integration on the mini uses. If
   it's actually a thinner relay (send-only + plain replies delivered some
   other way), the `TelegramGateway` class at the top of
   `telegram_approval_bridge.py` is the entire seam that needs to change —
   nothing else in the file assumes Bot-API specifics. Do not point
   `TELEGRAM_BOT_TOKEN` at a real bot until this is confirmed; a mismatched
   gateway assumption means `getUpdates` silently never returns anything,
   and replies would never be drained (fails closed, not open — see
   Limitations below).
2. **(O2 — ANSWERED, 7 July 2026) Put the numeric chat id in
   `TELEGRAM_CHAT_ID_ALLOWLIST`.** Isaac confirmed his id:

   ```bash
   TELEGRAM_CHAT_ID_ALLOWLIST=115000320
   ```

   Set exactly that in `~/twin/.env`. This is the *only* authZ boundary on
   the reply side (§7) — an empty value fails closed (nobody can decide,
   safe); a wrong value would let the wrong person decide (unsafe). If the
   id ever needs re-checking, message the bot and read `from.id` off the
   first `getUpdates` response, or use `@userinfobot`.

Until both are done, the worker can still be exercised safely with
`--dry-run` (and `--dry-run --fixture <path>` needs neither) — see Testing
below.

## The two responsibilities, per tick

1. **Scan → send.** `GET {COMMAND_CENTER_URL}/api/hermes/drafts?status=
   pending`; for each `pageId` not already confirmed-sent (state file's
   `sent` map), send one Telegram message to every id in
   `TELEGRAM_CHAT_ID_ALLOWLIST` and record it. At-most-once send per draft;
   a crash between "send" and "state write" re-sends next tick (a harmless
   duplicate message, not a lost draft).
2. **Drain replies → write back.** Pull inbound Telegram updates
   (`getUpdates`, cursor persisted in the state file); for each reply that
   maps to a known `pageId` (via reply-to → `msgIndex`) and passes the
   allowlist check, `POST {COMMAND_CENTER_URL}/api/hermes/decisions`. A
   `200` with `noop:true` ("someone already decided this — a duplicate
   reply, or Isaac approved it in the web UI first") is a success, not a
   failure. On failure, the decision is queued in the state file's `retry`
   list and retried on subsequent ticks — Isaac's reply is never dropped on
   a transient Command Center outage.

## Reply grammar

Reply **to the specific draft message**:

- `A` — approve
- `R` or `R <reason…>` — reject, reason optional
- `E <full replacement text>` — edit (full replacement) then approve, in
  one logical decision

Case-insensitive on the leading token; everything after the first space is
the payload. A reply that isn't a reply-to, or replies to an unrecognised
message, gets a one-line nudge instead of a guess.

## Installing on the Mac mini

The worker expects to live at `<twin repo>/scripts/telegram_approval_bridge.
py`, alongside `sync_command_center_calibration.py`. Once the orchestrator
ships the branch:

```bash
cd ~/twin
git fetch origin calibration-bridge
git merge --ff-only origin/calibration-bridge   # or review + merge as a PR
```

Set the real values in `~/twin/.env` (see `hermes/.env.example`):

```bash
TELEGRAM_BOT_TOKEN=<from @BotFather, once O1 is confirmed>
TELEGRAM_CHAT_ID_ALLOWLIST=<Isaac's numeric id, from O2>
TELEGRAM_BRIDGE_POLL_SECONDS=300
BODY_EXCERPT_CHARS=600
```

## launchd job

Dedicated 5-minute job, separate from the 30-minute identity pull (approvals
want to feel prompt on a phone — coupling to the 30-min cadence would make a
Notion-agent draft wait up to half an hour before Isaac even sees it):

```xml
<!-- ~/Library/LaunchAgents/com.isaac.twin.telegram-bridge.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.isaac.twin.telegram-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>/Users/isaac/twin/scripts/telegram_approval_bridge.py</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/isaac/twin</string>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>StandardOutPath</key>
  <string>/Users/isaac/twin/logs/telegram-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/isaac/twin/logs/telegram-bridge.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.isaac.twin.telegram-bridge.plist
```

Isaac (or the mini's operator) installs this directly — agents don't touch
the mini's launchd config.

## The quiet contract

Like the Phase 6 calibration-sync worker, this is silent when there is
nothing new: no new pending draft, no new reply to drain. A tick that did
something prints exactly one terse line:

```text
telegram bridge: sent 2 draft(s), applied 1 decision(s)
```

Never a body, a reject reason, or an edit replacement — see Security below.
Errors (a dropped non-allowlisted reply, a queued retry, a malformed reply)
go to stderr as one-line, `pageId`/action-only messages, never a traceback.

## Security

- `TELEGRAM_BOT_TOKEN` and `HERMES_API_TOKEN` live in `hermes/.env` on the
  Mac mini only, never in the repo (`.gitignore` already excludes `.env`).
  Neither is ever printed or logged by the worker, in any mode.
- Every inbound reply is checked against `TELEGRAM_CHAT_ID_ALLOWLIST`
  **before** any decision is POSTed. A non-allowlisted chat id is logged
  (the id only, never the message text) and dropped.
- No draft bodies, reject reasons, or edit replacement text ever reach
  stdout/stderr/the state file's non-essential fields — production ticks
  log `pageId` + action + outcome only; `--dry-run` previews message
  *structure* with free text replaced by a `<N chars, redacted>` marker.
  This is unconditional (no debug carve-out) — see the script's module
  docstring.
- Fails closed: an unset `TELEGRAM_BOT_TOKEN` / `HERMES_API_TOKEN` /
  `TELEGRAM_CHAT_ID_ALLOWLIST` disables the relevant half of the bridge for
  a real run (`exit 2`) rather than silently doing nothing in a way that
  could look like a delivered draft.
- Every decision is status-guarded on the Command Center side (409 → noop),
  so a replayed or duplicated reply cannot double-apply or flip a Rejected
  item back — see `docs/telegram-approval-bridge.md` §2/§7.

## Testing with `--dry-run`

```bash
cd ~/twin
python3 scripts/telegram_approval_bridge.py --dry-run
```

- With `TELEGRAM_BOT_TOKEN` / `HERMES_API_TOKEN` / `TELEGRAM_CHAT_ID_
  ALLOWLIST` all set: fetches real pending drafts and drains real Telegram
  updates, prints what it *would* send/POST, sends and writes nothing.
- Without full config: prints a clearly labelled "missing config" stub
  instead of erroring.

There is also a test-only `--fixture <path>` flag (mirrors the Phase 6
worker) that reads `{"drafts": [...], "updates": [...], "seedMsgIndex":
{...}}` from a local file, bypassing the network entirely for the read side
of both responsibilities — used for this phase's verification (see
`docs/changelogs/phase-9-hermes.md`). Not part of the production cron path.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success — sent/decided something and printed one terse line, or nothing changed and the run was silent. |
| `2` | Required live config missing (`TELEGRAM_BOT_TOKEN` / `HERMES_API_TOKEN` / `TELEGRAM_CHAT_ID_ALLOWLIST`) for a real, non-fixture run. |
| `3` | The `--fixture` file failed structural validation. Nothing was written. |
| `4` | Network error, timeout, malformed JSON, or an unexpected exception. |

## Still needs external credentials or source details

- `TELEGRAM_BOT_TOKEN` — needs a Telegram bot created via @BotFather, and
  O1 confirmed first (is the mini's real gateway the Bot API, or something
  else?). Ask Isaac; never invent one.
- `TELEGRAM_CHAT_ID_ALLOWLIST` — Isaac's exact numeric Telegram id (O2).
- `HERMES_API_TOKEN` — already required by the Phase 6 worker; reused here.

Until these are set, `scripts/telegram_approval_bridge.py --dry-run` (with
or without `--fixture`) still shows the shape of the worker's output safely.
