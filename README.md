# Isaac Twin — Command Center

The approval + publishing surface for Isaac's content twin (PRD v1.1). Phone-first: review drafts → Approve/Reject/Edit → the app schedules via Typefully → Typefully publishes to X/LinkedIn → the app reconciles status back to Notion. Notion stays the single source of truth; the app holds no primary data.

## Current workflow

Claude routines read the Personal Constitution in Notion and write drafts to its platform databases. The Command Center reads those databases directly; review decisions, edits and survey answers are written back to Notion. You use the app as your interface.

No Hermes runtime or GitHub identity mirror is required. The retired integration routes and worker scripts were removed on 7 October 2026. Historical plans are explicitly marked retired. See [current architecture](docs/current-architecture.md).

## Stack

Next.js 15 (App Router, TypeScript, Tailwind 4) on Vercel. Notion official API (pinned `Notion-Version: 2025-09-03`, data sources era). Typefully API v2. Vercel Cron for publish + reconcile. No database.

## Setup

1. **Notion integration** — create an internal integration at notion.so/my-integrations, then grant it access to all 7 DBs (X, LinkedIn, IG Story, IG Carousel, Positions, Inbox, Wiki) **and** the Constitution hub page via Notion → Connections.
2. **Env** — `cp .env.example .env`, fill in `NOTION_TOKEN`. Generate `AUTH_SECRET` (sha256 of your passphrase), `SESSION_SECRET`, `CRON_SECRET` — commands are in the file.
3. **Discovery** — `npm run discover` verifies every configured data source id resolves and prints Status property types. Fix any ✗ rows in `.env`.
4. **Migration** — `npm run migrate` (idempotent, strictly additive): adds `Typefully ID` / `Scheduled At` / `Approved At` / `Edited Before Approval` / `Original Draft` to the 4 content DBs, extends Status options, and creates the **Pipeline Events** DB under the Constitution hub. Paste the printed id into `DS_EVENTS`.
   - If a DB uses a *status-type* Status property, Notion's API can't add options — the script prints exactly what to add by hand.
5. **Typefully** — create an API key (needs a plan with API + LinkedIn publishing), set `TYPEFULLY_API_KEY`. Optionally pin `TYPEFULLY_SOCIAL_SET_ID` (otherwise the first social set is used).
6. **Run** — `npm run dev`, log in with your passphrase.

## Deploy (Vercel)

- Import the repo, set every var from `.env.example` in Project → Environment Variables (plus `CRON_SECRET`, which Vercel sends to cron routes as `Authorization: Bearer`).
- `vercel.json` schedules: publisher at 07:00 & 17:00 SGT (23:00 & 09:00 UTC), reconciler hourly.

## Behaviour guarantees

- Nothing reaches Typefully without an explicit Approve; crons are idempotent (items carrying a `Typefully ID` are skipped).
- Publisher only touches items whose status is exactly `Approved`; unknown statuses are ignored (other agents write to these DBs).
- Slots: X daily 08:30 SGT; LinkedIn Mon/Wed/Fri 09:00 SGT; taken slots skipped, FIFO by approval time.
- Edit-then-approve stores the original body and logs an `Approved-with-edits` event with the diff.
- IG items never auto-publish — they move to the "post manually" lane with copy-to-clipboard, then Mark Posted.
- Reconciler flags items >2h past their slot (or Typefully `error`) as `Publish-failed`, once.

## Coordination notes

- The Sunday cleanup task must not delete `Queued` items (it currently deletes past-dated unposted drafts) — update it before going live.
- Once live, retire the Cowork artifact dashboard and `dashboard-daily-refresh`.

## API

`POST /api/items/:pageId/approve` is deliberately single-purpose so a future Telegram webhook (Phase 3) can call it. Other routes: `/reject`, `/edit` (`{text}`), `/mark-posted`, `/unqueue`, `/publish-next`; `GET /api/queue`, `/api/kpis?window=7|28`, `/api/panels`. Cron: `POST|GET /api/cron/publish`, `/api/cron/reconcile` (require `CRON_SECRET`).
