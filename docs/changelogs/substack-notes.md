# Changelog — Substack Notes lane

*29 July 2026. Adds Substack Notes as the fifth content platform, auto-published through Typefully v2's `substack` platform.*

## Why

Typefully v2 now exposes `substack` alongside `x`, `linkedin`, `mastodon`, `threads`, `bluesky` and `x_article` in the draft `platforms` object. That closes the last gap in the funnel: the Larger back catalogue (39 essays as of today) had no daily surface on Substack itself. One observation-only Note per day, mined from one essay on a least-recently-used rotation, drafted by an agent into Notion, approved in the Command Center, scheduled by the existing publisher cron.

The Note is **observation-only**: no essay link, no CTA, no teaser. Rationale and voice rules live in `Substack Notes Workflow.md` in the AI Constitution folder.

## Notion

- **New DB: Substack Notes** — `collection://83e1fe3e-136b-41d3-8c61-333ab0882b0b`, under the Personal Constitution hub. Schema mirrors X Daily Tweets (Status / Typefully ID / Scheduled At / Approved At / Edited Before Approval / Original Draft / Created By / Humanizer / Source Workflow) plus three rotation fields: `Source essay` (url), `Source essay title` (text), `Lens` (select), and `Char count` (number). Title property is `Note`; body lives in page content, same convention as X and LinkedIn.
- **Pipeline Events** — `Platform` select gained a `Substack` option.
- **Calibration Events** — `Platform` select gained a `substack` option.

Both option adds were made ahead of the first write so `logEvent` and `logCalibrationEvent` never hit an unknown-option error.

## Code

| File | Change |
| --- | --- |
| `lib/config.ts` | `PlatformKey` gains `"substack"`; new `PLATFORMS` entry (`dsEnv: DS_SUBSTACK_NOTES`, `bodyInPageContent: true`, `autoPublish` gated on `TYPEFULLY_PLATFORMS.has("substack")`); `PLATFORM_EVENT_NAMES.substack = "Substack"` |
| `lib/scheduling.ts` | `SchedulablePlatform` gains `"substack"`; cadence = daily at **21:00 SGT** (09:00 US Eastern) |
| `lib/typefully.ts` | `createScheduledDraft` accepts `"substack"`; always a single post (thread breaks deliberately not honoured); `getDraftState` also reads `substack_published_url` |
| `lib/items.ts` | `createDraft` error message lists the new platform |
| `lib/calibration-events.ts` | `CalibrationPlatform` gains `"substack"` |
| `lib/actions.ts` | `calibrationPlatform()` allowlist gains `"substack"` |
| `components/types.ts` | `PlatformKey` + a `SUBSTACK` tab |
| `components/CommandCenter.tsx` | ⌘K palette filter list |
| `components/ApprovalQueue.tsx` | `CHAR_LIMITS.substack = { limit: 600, hard: false }` — a voice guardrail, not the platform's 10,000 |
| `components/KpiPanel.tsx` | per-platform strip 4 → 5 columns, `SUB` label |
| `scripts/discover.ts` | expects `DS_SUBSTACK_NOTES` |
| `scripts/migrate.ts` | Substack Notes joins `CONTENT_DS`; Calibration Events Platform options gain `substack` |
| `scripts/verify-typefully.ts` | 4 new gate assertions for the substack lane |
| `.env`, `.env.example` | `DS_SUBSTACK_NOTES`, `TYPEFULLY_PLATFORMS=x,substack` |

`publisher.ts` and both cron routes needed no changes: they already iterate `PLATFORMS.filter(p => p.autoPublish)`.

## Cron

No `vercel.json` change. The publisher already runs 07:00 and 17:00 SGT; the 17:00 run covers the same-day 21:00 Substack slot.

## Deploy checklist

1. Set on Vercel (Production): `DS_SUBSTACK_NOTES=83e1fe3e-136b-41d3-8c61-333ab0882b0b` and `TYPEFULLY_PLATFORMS=x,substack`.
2. Grant the Notion integration access to the Substack Notes DB (Notion → the DB → Connections).
3. Confirm Substack is connected on the Typefully social set pinned by `TYPEFULLY_SOCIAL_SET_ID`. Without it the publisher will 4xx on create and log `Publish-failed` while leaving the row `Approved`, which is the intended safe failure.
4. Dry run: approve one Note, let the publisher schedule it, confirm the Typefully draft, then delete it from Typefully and unqueue before doing a real end-to-end.

## Verified

- `npx tsc --noEmit` clean.
- `parseTypefullyPlatforms` / `autoPublish` gate assertions pass for the substack lane, including the "no API key means manual even when listed" case.
- `npm run verify:typefully` could not run in the connected-folder VM: `node_modules` carries the darwin-arm64 esbuild binary, so `tsx` refuses on linux-arm64. Run it locally on the Mac.

## Not done

- No `substack` entry in `lib/kpis.ts` beyond what `perPlatform` derives generically. Confirmed it keys off the Pipeline Events `Platform` value, so `Substack` flows through with no change.
- Analytics (`GET /v2/social-sets/{id}/analytics/substack/posts`) not wired. Deferred with the rest of the analytics work.
