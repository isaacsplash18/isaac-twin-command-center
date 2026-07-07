# Telegram Approval Bridge — Design (Phase 8)

> **⏸ PAUSED — 8 July 2026, by Isaac's direction.** Draft approvals, edits and
> calibration review are moving into the Command Center as the *only* review
> surface. Do **not** use Telegram for draft approval. The Phase 9 code (CC
> endpoints + `telegram_approval_bridge.py`) stays in the repo and in
> hermes-context PR #1, inert: the worker is simply never installed/scheduled,
> and the machine-lane endpoints it would call remain safe (they are the same
> ones the Command Center flow uses). Hermes continues only as the worker/sync
> layer (calibration sync worker is unaffected). Reactivating later = install
> the worker per its runbook; nothing needs rebuilding.


*Companion to `docs/hermes-calibration-plan.md` §4.6 and the build brief's "Phase 8
— Telegram Approval Bridge Design". This is **design only**. No code ships from this
document. Implementation is **Phase 9** and is **gated on Isaac's explicit approval of
this doc** (his own instruction, `docs/build-brief.md` line 556: "Do not code until this
design is approved"). Drafted 07 July 2026.*

The bridge closes the loop the Master Spec already names: *"push each draft to Isaac over
Telegram. When he replies to approve, flip the Notion status and trigger publishing.
Edits and rejections route back the same way."* (`Twin System — Master Spec (Hermes
Handoff).md` §8.6). Everything below is the concrete wiring for that one sentence, grounded
in what Phases 3–7 actually shipped.

---

## 0. Scope and non-goals

**In scope (v1):** a Mac-mini-side Hermes worker that (a) notices new pending-review
drafts in the Command Center, (b) sends them to Isaac on Telegram, (c) reads his
approve / reject / edit reply, and (d) writes the decision back through a new
machine-lane Command Center endpoint, producing the same status change + CalibrationEvent
(+ Pipeline Event) that a click in the web UI produces — tagged `source: telegram`.

**Non-goals (v1):** no publishing (guardrail 1, `build-brief.md`), no canonical-identity
mutation, no diff-based edits over chat (full-replacement only), no linking Telegram
rejections to Position proposals (drafts carry no `affectedPositionIds` — Phase 3/4
limitation, cited in §6), no timeout/expiry on pending drafts (they simply stay pending).

---

## 1. Proposed flow

Two entry points create a pending draft, both landing in the same place — a page with
`Status: Draft` in one of the four content DBs (X / LinkedIn / IG Story / IG Carousel),
which the existing approval queue already renders with zero UI changes (`lib/actions.ts`
treats `Draft` as the pending-review state; `docs/hermes-calibration-plan.md` §4.4):

1. **Hermes drafts it** — loads soul + constitution + the platform pack, drafts, runs the
   blocking Humanizer gate (`scripts/gate_draft.sh` → `humanizer_check.py`), then
   `POST /api/hermes/drafts` (Phase 7, §4.4). Hermes already holds the title/body here, so
   it can send Telegram immediately without a read-back.
2. **A Notion agent drafts it** — an existing content agent writes a `Draft` page directly.
   Hermes did **not** author this one, so the worker must fetch its body over the machine
   lane before it can render a Telegram message (see §2, `GET /api/hermes/drafts`).

End-to-end sequence:

```text
┌──────────┐   ┌──────────────────┐   ┌───────────────────────┐   ┌──────────┐   ┌────────┐
│  Hermes  │   │ Command Center   │   │ Notion (4 content DBs, │   │ Telegram │   │ Isaac  │
│ (mini)   │   │ (Vercel, Next.js)│   │  Calibration Events)   │   │ gateway  │   │ (phone)│
└────┬─────┘   └────────┬─────────┘   └───────────┬───────────┘   └────┬─────┘   └───┬────┘
     │                  │                         │                    │             │
     │ (a) Hermes draft: POST /api/hermes/drafts  │                    │             │
     ├─────────────────>│  create page Status=Draft ────────────────> │             │
     │  {pageId}        │                         │  (Created By=hermes)│            │
     │<─────────────────┤                         │                    │             │
     │                  │                         │                    │             │
     │ (b) Notion-agent draft appears directly ──>│  Status=Draft      │             │
     │                  │                         │                    │             │
     │ ── 5-min poll ──>│ GET /api/hermes/drafts?status=pending        │             │
     │  [id,platform,   │<── list w/ bodies ──────┤                    │             │
     │   title,body,    │                         │                    │             │
     │   humanizer]     │                         │                    │             │
     │                  │                         │                    │             │
     │  for each UNSEEN draft id (state file dedup): send once         │             │
     ├──────────────────────────────────────────────────────────────> │ message ──> │
     │  record msg_id ↔ pageId in .telegram-bridge-state.json          │             │
     │                  │                         │                    │             │
     │                  │                         │                    │  reply:     │
     │                  │                         │                    │  A / R … /  │
     │  getUpdates / gateway inbound              │                    │  E <text>   │
     │<──────────────────────────────────────────────────────────────┤ <────────── │
     │  map reply → pageId via reply-to msg_id (or button callback)    │             │
     │  allowlist check: chat_id == Isaac?                             │             │
     │                  │                         │                    │             │
     │ POST /api/hermes/decisions                 │                    │             │
     │  {pageId, action, editedText?, reason?,    │                    │             │
     │   source:"telegram", idempotencyKey}       │                    │             │
     ├─────────────────>│ re-read page (409 if status≠Draft)           │             │
     │                  │ approve/reject/edit via lib/actions.ts        │            │
     │                  ├── status → Approved/Rejected ──────────────> │             │
     │                  ├── CalibrationEvent (source=telegram) ───────>│ (Cal. Events DB)
     │                  ├── Pipeline Event (KPIs, unchanged) ─────────>│             │
     │  200 {ok} or     │                         │                    │             │
     │  409→treated as  │                         │                    │             │
     │  success-no-op   │                         │                    │             │
     │<─────────────────┤                         │                    │             │
     │  mark pageId decided in state; ACK to Isaac on Telegram ──────> │ "Approved ✓"│
     │                  │                         │                    │             │
     │  Command Center UI reflects new status on next /api/queue poll  │             │
```

**Per-action detail:**

- **APPROVE** (`A`, or the APPROVE button): `action:"approve"` → `approveItem(pageId)` →
  `Status: Approved`, `Approved At` set, Pipeline Event `Approved`, CalibrationEvent
  `approve` / `objectType:"draft"` / `source:"telegram"`. Never publishes (publishing is a
  separate, still-dormant lane — `publisher.mode` stays `manual` unless Typefully is wired).
- **REJECT** (`R optional reason…`, or REJECT button then a reason prompt):
  `action:"reject"`, `reason?` → `rejectItem(pageId, reason)` → `Status: Rejected`,
  Pipeline Event `Rejected`, CalibrationEvent `reject` with `rawUserText = reason`,
  `source:"telegram"`. Reason is optional; absent reason still rejects (see §6).
- **EDIT** (`E <full replacement text>`, or EDIT button then the replacement): captured as a
  **single logical EDIT-APPROVE** — `editItem(pageId, text)` then `approveItem(pageId)` (see
  §5). Produces an `edit` CalibrationEvent (`rawUserText`/`newText` = the replacement) **and**
  an `approve` one; the approve logs Pipeline Event `Approved-with-edits` (because
  `editItem` sets `Edited Before Approval`), and stores the pre-edit body in `Original Draft`
  for the Edit Ledger diff.
- **IGNORE / timeout:** none. If Isaac never replies, the draft simply stays `Status: Draft`
  — it keeps appearing in the queue and can still be actioned from the web UI. The worker
  does **not** re-send a draft it has already sent (state-file dedup, §3); no nagging, no
  expiry.

---

## 2. Required Command Center API endpoints

### What already exists

| Endpoint | Lane | Reuse for the bridge? |
|---|---|---|
| `POST /api/items/[pageId]/{approve,reject,edit}` | Human session cookie | **No** — see below |
| `GET /api/hermes/export` | Machine (Bearer `HERMES_API_TOKEN`) | Only for a heartbeat: it returns `drafts.pendingReview` as a **count**, not draft ids/bodies (`docs/hermes-integration.md`), so it cannot drive message rendering. |
| `POST /api/hermes/drafts` | Machine | Phase 7 **create** path. Its response gives Hermes the `pageId` of drafts *it* creates — enough to message those without a read-back. |
| `lib/actions.ts` `approveItem` / `rejectItem` / `editItem` | (library) | **Yes** — the decisions endpoint wraps these directly. Re-read-before-write and 409-on-wrong-status already live here. |

**Why not reuse `POST /api/items/[pageId]/*`?** Those routes sit behind the human lane —
`middleware.ts` requires a valid `SESSION_COOKIE` (HMAC session, `lib/auth.ts`) for
everything except the `PUBLIC_PREFIXES` (`/login`, `/api/auth/login`, `/api/cron/`,
`/api/hermes/`). A headless Mac-mini worker has no session cookie and must not be given
Isaac's passphrase or a forged cookie (guardrail 3: no secrets in code; guardrail 4: no
invented credentials). The machine lane (`/api/hermes/`, Bearer `HERMES_API_TOKEN`,
`lib/machine-auth.ts`) is exactly the lane built for this. So the bridge gets a
machine-lane sibling of the decision routes rather than punching a hole in the session
lane. The `approve/reject/edit` route files even carry a comment anticipating this: *"kept
clean so a future Telegram webhook (Phase 3) can call it directly"* — but the clean call is
into `lib/actions.ts`, not through the session-guarded HTTP route.

### What's new (Phase 9)

**(N1) `POST /api/hermes/decisions`** — machine lane, the write-back path.

```jsonc
// Request
{
  "pageId": "…",                       // required — the Draft page id
  "action": "approve" | "reject" | "edit",  // required
  "editedText": "…",                   // required iff action == "edit" (full replacement)
  "reason": "…",                       // optional, action == "reject" only → CalibrationEvent.rawUserText
  "source": "telegram",                // recorded on the CalibrationEvent (default "telegram" for this route)
  "idempotencyKey": "tg:<chat>:<update_id>"  // optional; see idempotency note
}
```

```jsonc
// Response 200 — decision applied
{ "ok": true, "pageId": "…", "action": "approve", "status": "Approved", "noop": false }

// Response 200 — already decided (idempotent no-op; see below)
{ "ok": true, "pageId": "…", "action": "approve", "status": "Approved", "noop": true,
  "note": "already-decided" }
```

Behaviour:

- Auth: `isMachineAuthorized(req)` (`lib/machine-auth.ts`) → `401 {"error":"Unauthorised"}`
  otherwise. Falls closed when `HERMES_API_TOKEN` is unset, exactly like `export`.
- Dispatch: `approve` → `approveItem(pageId, "telegram")`; `reject` →
  `rejectItem(pageId, "telegram", reason)`; `edit` → `editItem(pageId, editedText,
  "telegram")` **then** `approveItem(pageId, "telegram")` (the EDIT-APPROVE pair, §5).
- **Small additive change to `lib/actions.ts`:** thread an optional
  `source: CalibrationSource = "command_center"` (and, for reject, an optional `reason`)
  through `approveItem` / `rejectItem` / `editItem` into the existing
  `logCalibrationEvent({...})` calls. `LogCalibrationEventInput` already accepts `source`
  and `rawUserText` (`lib/calibration-events.ts`), so this is one parameter per function,
  default-preserving — the web-UI routes keep logging `command_center` unchanged.
- **Error semantics / idempotency:** `approveItem`/`rejectItem`/`editItem` already throw
  `ActionError(409)` when the page is not `Draft`. The route catches a 409 from the wrapped
  action and returns **`200 { noop: true, note:"already-decided" }`** instead of surfacing
  the 409 — because for the bridge, "someone already decided this" (a duplicate reply, or
  Isaac approved it in the web UI first) is a **success**, not a failure. All other errors
  pass through `handleAction` unchanged (`400` bad body, `500` unexpected). This makes the
  endpoint replay-safe: re-POSTing the same decision is harmless.
- `idempotencyKey` (e.g. `tg:<chat_id>:<telegram_update_id>`) is accepted and echoed for
  the worker's own logs. **True dedup in v1 is status-based** (the 409→no-op above), not
  key-based — keying would need a dedicated Notion prop + migration, deferred (open
  question O5). Recording the key is cheap insurance and costs no schema.

**(N2) `GET /api/hermes/drafts?status=pending`** — machine lane, the read path for drafts
Hermes did **not** author.

- Returns the pending-review drafts with enough to render a message:
  `[{ pageId, platform, title, body, humanizer, createdBy, createdAt }]`, reusing
  `itemsWithStatus` + `readItemBody` (the same helpers `/api/queue` and `export` already
  use). `humanizer` / `createdBy` come from the Phase 7 additive props (`Humanizer`,
  `Created By`, §4.4).
- **Why this is needed and not in the brief's "~1 endpoint":** `export` gives only a
  *count* (`drafts.pendingReview`), and `docs/hermes-integration.md` deliberately keeps
  draft **bodies** off the machine lane, pointing readers at the *session-authed*
  `/api/queue` — which the headless worker cannot call. Without N2, the bridge can only
  message drafts Hermes itself created (it holds those bodies from the N-side of
  `POST /api/hermes/drafts`); Notion-agent-authored drafts would never reach Telegram. N2
  is the smallest machine-lane read that makes the flow complete. It can be folded into the
  Phase 7 `app/api/hermes/drafts/route.ts` file as its `GET` handler (POST creates, GET
  lists), so it is one new route file, two verbs.

`middleware.ts` already exempts `/api/hermes/` — **no middleware change** for either N1 or
N2 (this is the one shared file phases must coordinate on; here we touch nothing).

---

## 3. Hermes cron / job design

Grounded in the existing worker patterns: the identity pull already runs every 30 min and
is **silent unless HEAD moved** (`scripts/pull_identity_quiet.sh` — fetch, compare,
only then pull + echo), and the Phase 6 calibration sync worker keeps a state file
(`.calibration-sync-state.json`, last-seen ids) and is idempotent/quiet when nothing
changed (`docs/hermes-calibration-plan.md` §4.5). The bridge worker copies both habits.

- **Do not reuse the 30-min identity cron.** Approvals want to feel prompt on a phone;
  a 30-min lag between a Notion-agent draft appearing and it hitting Telegram is too slow,
  and coupling to the identity pull mixes concerns. **Recommend a dedicated 5-minute
  launchd job** (`com.isaac.twin.telegram-bridge`) running
  `hermes/scripts/telegram_approval_bridge.py`. (launchd `StartInterval 300`, matching how
  the mini already schedules its crons.)
- **Two responsibilities per tick:**
  1. **Scan → send.** `GET /api/hermes/drafts?status=pending`; for each `pageId` **not** in
     the state file's `sent` set, send one Telegram message and record
     `sent[pageId] = { msgId, sentAt }`. At-most-once send per draft.
  2. **Drain replies → write back.** Pull inbound Telegram updates (via the existing gateway
     — mechanism is open question O1; either the gateway's long-poll `getUpdates` cursor or
     a webhook the worker reads). For each reply that maps to a known `pageId` and passes
     the chat-id allowlist, `POST /api/hermes/decisions`; on `200` mark
     `decided[pageId]` and ACK to Isaac; on transient failure, enqueue to the retry file
     (§8).
- **State file** `~/twin/.telegram-bridge-state.json` (gitignored; `.gitignore` already
  excludes `.env`/secrets and this is machine-local scratch, never committed):

  ```jsonc
  {
    "sent":    { "<pageId>": { "msgId": 4821, "sentAt": "2026-07-07T09:00:00Z" } },
    "msgIndex":{ "4821": "<pageId>" },       // reply-to msg_id → pageId reverse map
    "decided": { "<pageId>": { "action": "approve", "at": "2026-07-07T09:03:00Z" } },
    "updateCursor": 771002341,               // Telegram getUpdates offset, if long-poll
    "retry":   [ /* decisions that failed write-back; see §8 */ ]
  }
  ```

- **At-most-once send / at-least-once safety:** a draft is sent only if absent from `sent`.
  To survive a crash between "send" and "write state", write an *intended-send* marker
  before the HTTP send and confirm it after; on restart, an intended-but-unconfirmed entry
  is re-sent (**at-least-once**, accepting a rare duplicate Telegram message as the safe
  failure — a second copy of a draft is harmless; a *never-sent* draft that silently misses
  approval is not). Write-backs are made exactly-once-in-effect by the status-based no-op
  (§2), so a re-sent draft that Isaac already approved just yields a `noop:true`.
- **Backoff:** on `5x`/network error from either Command Center or Telegram, exponential
  backoff (30 s → 1 m → 5 m, capped) within the tick; unfinished work rolls to the next
  5-min tick. The worker **never** blocks the identity pull or the drafting crons.
- **Quiet by default:** like `pull_identity_quiet.sh`, no stdout when nothing changed
  (no new drafts, no new replies) so it stays out of Hermes's log noise.

---

## 4. Message format

**Outbound (Command Center draft → Isaac).** One message per draft. Keep it phone-glanceable;
cap the body excerpt so a long carousel caption doesn't wall-of-text the chat.

```text
📝 DRAFT — LinkedIn · #a1b2c3
Humanizer: passed · via hermes

“The advisory game rewards the person who says the...
 quiet thing out loud. Here is the pattern I keep...”
 [body excerpt, capped ~600 chars, … if truncated]

Reply:  A  ·  R <reason>  ·  E <full replacement>
```

- **Header line:** platform (X / LinkedIn / IG Story / IG Carousel) + a short `#id` (last 6
  of the `pageId`, so Isaac and the logs can correlate).
- **Humanizer status** + `via hermes|agent` (from the `Humanizer` / `Created By` props). If
  `Humanizer: failed` the worker should not normally have sent it (the gate blocks upstream)
  — but surfacing it lets Isaac catch an escaped miss.
- **Body excerpt:** capped (~600 chars; configurable). Full body lives in the Command Center;
  the message is a decision aid, not the canonical copy.

**Reply grammar (two supported input modes — the gateway's capability decides which, O1):**

- **Inline keyboard (preferred, if the gateway is Bot-API based):** three buttons
  `✅ APPROVE` / `✏️ EDIT` / `🗑 REJECT`. APPROVE fires immediately. EDIT and REJECT put the
  worker into a short "awaiting text" state for that `pageId` (next message from Isaac is the
  replacement text / the reason). Button `callback_data` carries `pageId` directly, so no
  reply-to mapping is needed for the button press itself.
- **Reply-syntax fallback (always works, even a plain relay gateway):** Isaac **replies to**
  the draft message with:
  - `A` — approve
  - `R` or `R <reason…>` — reject, optional reason
  - `E <full replacement text>` — edit (full replacement) then approve
  Grammar is case-insensitive on the leading token; everything after the first space is the
  payload. Reply-to threading maps his reply's `reply_to_message.message_id` → `pageId` via
  `state.msgIndex`. If a reply can't be mapped (not a reply, unknown msg id), the worker asks
  him to reply to the specific draft rather than guessing.
- **ACK:** after a successful write-back the worker edits/answers with a one-line confirmation
  (`Approved ✓ #a1b2c3`, `Rejected ✓`, `Edited + approved ✓`), or `Already decided in Command
  Center ✓` on a `noop:true`.

Full-replacement only — **no inline diffs over chat** (§5). One draft ↔ one message ↔ one
decision.

---

## 5. How edits are captured

- **Full-replacement only in v1.** Isaac sends the whole new body (`E <text>` or the EDIT
  button's follow-up message). No patch/diff grammar over chat — it's error-prone on a phone
  and `editItem` takes a full body anyway.
- **EDIT resolves to a single EDIT-APPROVE decision.** Editing a draft in chat *means* "make
  it this and ship it" — the same thing the web UI does when Isaac edits then approves. So the
  decisions route runs `editItem(pageId, editedText, "telegram")` **then**
  `approveItem(pageId, "telegram")` as one logical action. This is deliberately not two
  separate round-trips from Telegram: one reply = one decision.
- **What it produces (matching the web UI's edit-then-approve semantics exactly):**
  - `editItem` writes the new body (page content for X/LinkedIn, or the `bodyProp` for IG
    Story/Carousel), sets `Edited Before Approval: true`, snapshots the pre-edit body into
    `Original Draft`, and logs a CalibrationEvent `edit` with `previousText` = old body,
    `newText`/`rawUserText` = the replacement, `source:"telegram"`.
  - `approveItem` then flips `Status: Approved`, and because `Edited Before Approval` is set,
    logs Pipeline Event **`Approved-with-edits`** (with the ORIGINAL→APPROVED diff) plus a
    CalibrationEvent `approve` (`previousText` = original, `newText` = final).
- **Idempotency of the pair:** if the process dies between the edit and the approve, a re-run
  is safe — the second `editItem` sees the body already changed but re-sets the flag
  harmlessly, and `approveItem` either approves the still-`Draft` page or returns the 409→
  no-op if it was already approved. Net effect converges.

---

## 6. How rejections become calibration events

- `action:"reject"` with optional `reason` → `rejectItem(pageId, "telegram", reason)` →
  `Status: Rejected`, Pipeline Event `Rejected` (KPIs, untouched), and a CalibrationEvent:
  `action:"reject"`, `objectType:"draft"`, `objectId: pageId`, `platform` from the page,
  `rawUserText = reason` (empty if none given), `source:"telegram"`,
  `inferredDelta` left blank (no deterministic delta for a draft rejection).
- This is the same `rejectItem` path the web UI uses; the only additions Phase 9 makes are
  the `source` tag and carrying the free-text `reason` into `rawUserText` (today's
  `rejectItem` logs a reject CalibrationEvent with **no** `rawUserText` — see
  `lib/actions.ts` and the Phase 3 changelog). Both are additive.
- **It does not generate a PositionUpdateProposal in v1 — by documented design.** The Phase 4
  generator (`maybeCreateProposalFromEvent`, `lib/proposals.ts`) only fires for `sharpen` /
  `reject`-**verdict** events that come from the weekly survey (`submitAnswer`) **and** carry
  a non-empty `affectedPositionIds`. Draft CalibrationEvents carry
  `affectedPositionIds: []` — *"drafts aren't linked to Positions in this data model yet"*
  (Phase 3 changelog, Limitations) — so a Telegram rejection reason is **captured** (visible
  in the events log and the Hermes export) but **flows into the proposal generator only via
  survey events**, never via a draft rejection. This is the honest v1 boundary, not a gap to
  paper over: the rejection reason is durable signal for the weekly review, which is where
  Position calibration actually happens.

---

## 7. Security model

- **Token storage.** `HERMES_API_TOKEN` (the machine-lane bearer, already live for Phase 5)
  lives in `hermes/.env` on the Mac mini, **never** in the repo — `.gitignore` already
  excludes `.env`, `*.key`, `secrets.*`. `.env.example` documents the *names* only
  (guardrail 3). Any Telegram bot token / chat id live in the same `hermes/.env`.
- **Chat-id allowlist.** Only Isaac's numeric Telegram user id may decide. The runbook
  confirms *"Telegram is connected and the numeric user ID is authorised"* — the worker
  re-checks `chat_id` (and/or `from.id`) against `TELEGRAM_CHAT_ID_ALLOWLIST` on **every**
  inbound reply before it will `POST /api/hermes/decisions`. A reply from any other id is
  dropped and logged (id only, never the text). This is the primary authZ boundary on the
  reply side — the Command Center trusts the bearer token; the *allowlist is what stops
  anyone-but-Isaac driving that token*.
- **Transport.** Machine lane over HTTPS to the Vercel deployment; `Authorization: Bearer`
  compared constant-time (`timingSafeEqualStr`, `lib/machine-auth.ts`), never logged, never
  echoed.
- **Idempotency + replay protection.** Every decision is status-guarded: a decision on an
  already-decided item is a `noop` (§2), so a replayed or duplicated Telegram reply cannot
  double-apply or flip a Rejected item back. `idempotencyKey` gives the worker a dedup handle
  in its own logs.
- **No draft bodies in logs.** The worker logs `pageId` + action + outcome only. Draft/edit/
  reason text is never written to stdout, the state file's non-essential fields, or any commit
  — it lives in Notion (via the Command Center) and, transiently, in the Telegram thread.
- **Fail closed.** Unset `HERMES_API_TOKEN` disables the whole machine lane (`401`), which
  disables the bridge — the same one-move kill switch as the export (§4.3 rollback).

---

## 8. Failure modes and retries

| Failure | Behaviour |
|---|---|
| **Command Center down / 5xx on write-back** | Isaac's reply is already in hand — do **not** drop it. Append the decision `{pageId, action, editedText?, reason?, idempotencyKey}` to `state.retry[]`, ACK Isaac with "queued, will apply shortly", and retry with backoff on this and following ticks. Never re-send the *Telegram draft* as a way to retry the *decision* (they're separate). The status-based no-op makes retries safe even if one silently succeeded. |
| **Telegram down / send fails** | Draft stays out of `state.sent` (or marked intended-unconfirmed), so it is retried next tick. Drafts never expire, so a Telegram outage just delays delivery — nothing is lost. No double-send: a draft already in `sent` is skipped. |
| **Write-back fails after Isaac replied** | Same as row 1 — the reply is preserved in `state.retry[]`; additionally the worker adds an **alert line to the next Hermes report / inbox note** (`inbox/telegram/…` or the existing calibration report) so a stuck decision surfaces to Isaac even if backoff keeps failing. |
| **Crash between send and state-write** | At-least-once send with dedup by `pageId` (§3): on restart, intended-but-unconfirmed sends re-fire (rare duplicate message, harmless); confirmed ones are skipped. |
| **Stale decision — draft already Approved/Rejected in the web UI** | `approveItem`/etc. throw 409 → route returns `noop:true, note:"already-decided"` → worker marks it decided and ACKs Isaac "Already decided in Command Center ✓". No error, no double-write. |
| **Unmappable reply** (not a reply-to, unknown msg id, or non-allowlisted chat) | Dropped safely: allowlist misses are logged (id only) and ignored; unmapped replies get a "reply to the specific draft" nudge. Never guesses which draft. |
| **Malformed reply** (`E` with no text, unknown leading token) | Worker replies with the one-line grammar reminder; no decision sent. |

The guiding asymmetry: **a missed approval (draft silently never delivered) is the worst
outcome**, so the design biases to at-least-once delivery + at-least-once write-back, made
safe by exactly-once *effect* via the status-based no-op.

---

## 9. Minimal implementation steps (Phase 9 — gated)

> Implementation is **Phase 9** and **must not start until Isaac approves this document**
> (`build-brief.md` line 556). The steps below are the plan the approval unlocks.

**(a) Command Center side — small.** (~1 new route file with two verbs + a
default-preserving tweak to `lib/actions.ts`; no middleware change.)

1. `lib/actions.ts`: add optional `source: CalibrationSource = "command_center"` to
   `approveItem`/`editItem`, and `source` + optional `reason` to `rejectItem`, threaded into
   the existing `logCalibrationEvent` calls. Web-UI routes unchanged (defaults preserve
   `command_center`).
2. `app/api/hermes/decisions/route.ts` (new) — `POST`, machine lane via
   `isMachineAuthorized`, `handleAction` pattern, dispatch to the wrapped actions, 409→
   `noop` translation (§2). `dynamic = "force-dynamic"`.
3. `app/api/hermes/drafts/route.ts` — add the `GET ?status=pending` list handler (N2)
   alongside Phase 7's `POST` (or a standalone route if Phase 7 hasn't landed).
4. `docs/hermes-integration.md` — extend with the `decisions` and `drafts GET` contracts +
   curl examples.
5. `scripts/verify-telegram-decisions.ts` (new) + `package.json` script — create a throwaway
   Draft page, exercise approve / reject-with-reason / edit-approve over the machine lane,
   assert status + CalibrationEvent `source:"telegram"` round-trips, assert the 409→`noop`
   path, then **archive** the test page (never touch real drafts — §6 verification plan).

**(b) Hermes side — medium.** (~1 Python worker extending the Phase 6 sync-worker patterns:
stdlib only, state file, idempotent, quiet-when-nothing-changed.)

6. `hermes/scripts/telegram_approval_bridge.py` (new, Python 3 stdlib only — the mini runs
   plain `python3`, no pip): scan→send, drain-replies→write-back, state file, allowlist
   check, reply-grammar parser, backoff, `--dry-run` (prints instead of sending/POSTing).
7. `hermes/runbooks/hermes-twin-runtime.md` — append a "Telegram approval bridge" section
   (launchd plist, state file, the two responsibilities, quiet contract).

**(c) Config — small.**

8. `hermes/.env.example` — add `COMMAND_CENTER_URL`, `HERMES_API_TOKEN` (already there for
   Phase 6), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID_ALLOWLIST`, `TELEGRAM_BRIDGE_POLL_SECONDS`
   (default 300), `BODY_EXCERPT_CHARS` (default 600) — names only, no values.
9. launchd job `com.isaac.twin.telegram-bridge` (`StartInterval 300`) — documented in the
   runbook, installed by Isaac (agents don't touch the mini's launchd directly).

**(d) Verification plan.**

10. `npm run verify:telegram-decisions -- --url http://localhost:3000` — machine-lane auth +
    the three actions + 409-no-op, throwaway page created-then-archived.
11. `python3 hermes/scripts/telegram_approval_bridge.py --dry-run` against a local Command
    Center — prints the Telegram messages it *would* send and the decisions it *would* POST,
    writes nothing.
12. `npx next build` stays green (the phase that owns the build runs it).
13. One end-to-end manual pass: create a throwaway Draft → confirm it reaches Telegram → reply
    `A` / `R reason` / `E text` in turn (on separate throwaway drafts) → confirm the Command
    Center shows Approved / Rejected / Approved-with-edits and the events log shows
    `source:"telegram"` → archive the test pages.

**Relative sizes:** (a) small, (b) medium (the worker is the bulk — polling, reply parsing,
state, retries), (c) small, (d) small. No canonical-identity writes anywhere; fully
reversible (revert the CC commit; delete the launchd job + worker on the mini; unset
`HERMES_API_TOKEN` to kill the lane in one move).

---

## Open questions for Isaac

- **O1 — Telegram gateway capability & inbound mechanism.** Does the existing Hermes Telegram
  gateway expose the **Bot API** (so we get inline keyboards + `callback_data` + `getUpdates`
  cursor / webhook), or is it a thinner relay (send-only + plain replies)? This decides
  inline-buttons vs reply-syntax as the primary UX, and long-poll vs webhook for draining
  replies. The design supports both; confirming lets Phase 9 build one path cleanly.
- **O2 — Exact chat id.** The runbook says "the numeric user ID is authorised" but doesn't
  print it. Confirm the numeric `chat_id`/`from.id` for `TELEGRAM_CHAT_ID_ALLOWLIST` (kept in
  `hermes/.env`, never committed).
- **O3 — Poll cadence.** 5-minute dedicated bridge poll (recommended) vs coupling to the
  existing 30-minute identity pull? 5 min favours phone-side responsiveness; confirm it's not
  too chatty for the mini.
- **O4 — Should the bridge message drafts from Notion agents too, or only Hermes-authored
  drafts?** If only Hermes's own, N2 (`GET /api/hermes/drafts`) can be dropped and the worker
  sends straight off the `POST /api/hermes/drafts` response. If all pending drafts, N2 is
  required. (Recommendation: all pending — one queue, one bridge.)
- **O5 — Idempotency key storage.** Accept status-based dedup only (v1 recommendation), or add
  a Notion prop to record `idempotencyKey` per decision (a migration) for hard exactly-once at
  the network layer?
- **O6 — ACK verbosity.** Does Isaac want a per-decision Telegram confirmation
  (`Approved ✓`), or silent-on-success to keep the thread quiet? (Recommendation: brief ACK —
  it's the only signal the write-back landed.)
