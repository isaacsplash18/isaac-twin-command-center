### Phase 8 — Telegram Approval Bridge (Design)

**Design delivered, no code.** Added `docs/telegram-approval-bridge.md` — the nine
brief-required sections (proposed flow with an end-to-end ASCII sequence diagram; required
Command Center endpoints; Hermes cron/job design; message format; edit capture; rejection→
CalibrationEvent mapping; security model; failure modes and retries; minimal implementation
steps) plus an "Open questions for Isaac" section. The design is grounded in the shipped
Phases 3–7: it wraps the existing `lib/actions.ts` `approveItem`/`rejectItem`/`editItem`
(re-read-before-write, 409-on-wrong-status) behind a new machine-lane `POST
/api/hermes/decisions` (Bearer `HERMES_API_TOKEN`, `lib/machine-auth.ts`) rather than reusing
the session-authed `/api/items/[pageId]/*` routes; records `source:"telegram"` on the
CalibrationEvent (the `logCalibrationEvent` input already supports `source`); treats
409-already-decided as a success no-op for idempotency; and mirrors the Hermes worker patterns
(`pull_identity_quiet.sh`'s quiet-unless-changed habit, the Phase 6 state-file/idempotent
model, `humanizer_check.py` gate, stdlib-only Python). **No implementation code, no builds, no
migrations, no server or config changes.** Implementation is **Phase 9 and is gated on Isaac's
explicit approval of this document** (build brief: "Do not code until this design is
approved"). Open questions raised for Isaac: (O1) whether the Telegram gateway is Bot-API
(inline keyboards + getUpdates/webhook) or a thinner relay; (O2) the exact numeric chat id for
the allowlist; (O3) 5-minute dedicated poll vs coupling to the 30-minute identity pull; (O4)
whether the bridge should message Notion-agent-authored drafts too (needs a new machine-lane
`GET /api/hermes/drafts`) or only Hermes-authored ones; (O5) status-based idempotency only vs
adding a Notion prop to store the idempotency key; (O6) per-decision Telegram ACK vs
silent-on-success.
