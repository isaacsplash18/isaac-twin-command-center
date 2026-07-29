#!/bin/bash
# One-shot setup for the Substack Notes + LinkedIn auto-publish lanes.
#   1. clears the stale git lock
#   2. commits the staged work
#   3. deploys
# (the Vercel env vars are already set - Claude did that in the browser)
# Written for Isaac by Claude, 29 July 2026. Safe to delete after it runs.
cd "$(dirname "$0")" || exit 1

VC="vercel"
command -v vercel >/dev/null 2>&1 || VC="npx --yes vercel@latest"

echo "=== 1/3  Clearing the stale git lock ==="
rm -f .git/index.lock && echo "    done"

echo
echo "=== 2/3  Committing ==="
if [ -z "$(git config user.email)" ]; then
  git config --local user.name  "isaacsplash18"
  git config --local user.email "isaac.ho@splashadvisory.co"
fi
if git diff --cached --quiet; then
  echo "    nothing staged, skipping"
else
  git commit -F - <<'MSG'
feat: Substack Notes lane + LinkedIn auto-publish

Substack Notes becomes the fifth content platform: one observation-only Note
per day, mined from the Larger back catalogue on a least-recently-used
rotation, drafted into Notion by an agent, approved in the Command Center,
scheduled through Typefully v2's `substack` platform at 21:00 SGT.

- lib/config.ts: PlatformKey + PLATFORMS entry (DS_SUBSTACK_NOTES, autoPublish
  gated on TYPEFULLY_PLATFORMS) + event name
- lib/scheduling.ts: SchedulablePlatform + daily 21:00 SGT cadence
- lib/typefully.ts: createScheduledDraft accepts "substack" (always a single
  post); reads substack_published_url
- lib/items.ts, lib/actions.ts, lib/calibration-events.ts: platform allowlists
- components: SUBSTACK tab, 600-char soft limit, 5-column KPI strip
- scripts/discover.ts, scripts/migrate.ts, scripts/verify-typefully.ts
- docs/changelogs/substack-notes.md

LinkedIn auto-publish needed no code: it was already implemented and only
gated by TYPEFULLY_PLATFORMS, now x,substack,linkedin. Known gap: Typefully's
"Add LinkedIn comment" is not exposed in the v2 API, so Essay-link posts
publish without the first comment and need it added by hand.

Also carries pre-existing uncommitted work already in the tree (the Nova /
liquid-glass typography restyle), which could not be cleanly separated
because ApprovalQueue.tsx, CommandCenter.tsx and KpiPanel.tsx contain both
sets of edits. Nothing was discarded.
MSG
  echo "    committed: $(git log --oneline -1)"
fi

echo
echo "=== 3/3  Deploying to production ==="
$VC --prod

echo
echo "=== Finished. Tell Claude and it will verify all three lanes. ==="
echo "Press any key to close."
read -n 1 -s
