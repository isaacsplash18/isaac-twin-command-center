# Mobile-first cockpit + Nova app icon

Two independent workstreams landed together: (1) making the Command Center
genuinely usable on a phone, (2) shipping Nova's face as the home-screen /
favicon icon.

## 1. Mobile layout

### Files changed
- `components/CommandCenter.tsx` — restructured the cockpit grid so the
  approval queue is a grid item (not a separate full-width block below the
  grid) with responsive `order-*`/`lg:order-*` classes.
- `components/NovaStage.tsx` — responsive calibration-card overlap; tap
  targets on CONFIRM/SHARPEN/REJECT and SUBMIT/LATER; `break-words` on
  question title/guess/why.
- `components/ApprovalQueue.tsx` — tap targets on platform tabs and
  APPROVE/REJECT/EDIT/SAVE/CANCEL; `break-words` on draft body + slide texts.
- `components/QueuePanel.tsx` — tap targets + larger mobile font on the
  shared `MiniBtn` (COPY, MARK POSTED, PUBLISH NEXT SLOT, UNQUEUE).
- `components/ProposalsPanel.tsx` — same `MiniBtn` treatment (ACCEPT/REJECT);
  `break-words` on current/proposed position text and reason.
- `components/KpiPanel.tsx` — tap target + font bump on the 7D/28D toggle.

### (a) Mobile ordering — how it was achieved
The three cockpit modules (left panels, Nova, right panels) and the approval
queue used to be two separate DOM structures: a 3-col grid, then a plain
`<div className="mt-6">` sibling holding `ApprovalQueue` full-width below it.
That's why the queue was always dead last on mobile, regardless of `order-*`
classes on the grid children — it wasn't a grid child at all.

Fix: `ApprovalQueue` moved *inside* the grid as a fourth grid item, with:
```
order-2 lg:order-4 lg:col-span-3 lg:mt-2
```
All four grid children now carry a mobile order and an `lg:order` override:

| Item | mobile order | lg order | lg placement |
|---|---|---|---|
| Nova | 1 | 2 | column 2 |
| Approval Queue | 2 | 4 | row 2, spans all 3 columns |
| Queue & Posted + KPI | 3 | 1 | column 1 |
| Proposals + Positions + Inputs + Automations | 4 | 3 | column 3 |

Below `lg`, `grid-template-columns` is unset (single implicit column, same
mechanism the original mobile stack already relied on), `lg:col-span-3` is
inert (no columns to span), so items simply stack in `order` sequence:
**Nova → Approval Queue → Queue&Posted/KPIs → Positions/Inputs/Automations.**

At `lg`+, CSS Grid's order-modified row-major auto-placement puts order-1/2/3
into row 1's three explicit column tracks (Queue&KPI, Nova, Proposals — the
exact original desktop arrangement), then order-4 (`col-span-3`) doesn't fit
the remaining row-1 space and drops to row 2, spanning full width — visually
identical to the old "grid, then a full-width sibling below" structure.

**Spacing parity:** originally the gap above the full-width queue was a
`mt-6` (24px) margin on the sibling div, on top of zero grid contribution.
Now that it's a grid row, the grid's own `gap-4` (16px row-gap) already
applies between row 1 and row 2, so `lg:mt-2` (8px) was added to the
queue item specifically to make the total 16+8=24px — matching the original
exactly. This extra margin is `lg:`-only, so it doesn't add unwanted space on
mobile (where item-to-item spacing is now the uniform 16px grid gap).

### (b) Calibration card overlap
`-mt-40` (10rem/160px, a fixed overlap) became `-mt-16 sm:-mt-40` in
`NovaStage.tsx`. At 375px, Nova is ~335px tall (`Math.min(430, innerWidth-40)`
in `Nova.tsx`); a 160px overlap was eating roughly half of her. 64px (`-mt-16`)
leaves her face/torso visible while the card still visually anchors to her.
Desktop (`sm:` and up) keeps the original `-mt-40`.

### (c) Tap targets (≥44px on mobile)
Applied a consistent pattern: `flex min-h-11 items-center justify-center …
sm:min-h-0` on every listed button, reverting to the original (smaller)
desktop sizing at `sm:`+. Covered: APPROVE/REJECT/EDIT, SAVE/CANCEL
(`ApprovalQueue.tsx`), CONFIRM/SHARPEN/REJECT, SUBMIT/LATER (`NovaStage.tsx`),
platform tabs (`ApprovalQueue.tsx`), the shared `MiniBtn` used for
COPY/MARK POSTED/PUBLISH NEXT SLOT/UNQUEUE (`QueuePanel.tsx`) and
ACCEPT/REJECT (`ProposalsPanel.tsx`), and the KPI window toggle
(`KpiPanel.tsx`) for consistency.

### (d) Paper-cut sweep
- **Overflow/wrap:** added `break-words` to draft body, slide texts,
  calibration question title/guess/why, proposal current/proposed text and
  reason, toast messages, and the publish-failure/queue-error banners — any
  place holding free-form Notion text (which can contain unbroken URLs).
- **Sub-11px tappable text:** bumped the 9–10px button labels above to 11px
  on mobile (`text-[11px] sm:text-[9px]`/`sm:text-[10px]`) — platform tabs,
  verdict buttons, `MiniBtn`, KPI toggle. Non-interactive labels/badges (e.g.
  `StatusPill`, section headers) were left as-is — those are brand/HUD
  typography, not something the sweep was asked to redesign.
- **Platform tab row wrapping:** already used `flex-wrap` in both
  `ApprovalQueue.tsx` (platform tabs) and `NovaStage.tsx` (verdict buttons);
  no change needed there beyond the tap-target sizing above.
- **Toast width:** already `w-full max-w-sm` with `px-4` outer padding —
  fits comfortably at 375px without change; added `break-words` as a
  defensive measure for unusually long error strings.

## 2. Nova app icon

### Crop
Settled on `(388, 0, 618, 230)` out of the 1000×500 `public/nova.png` (a
230×230 square) after iterating through ~6 candidate boxes rendered to
`/private/tmp/.../scratchpad/crop_*.png` and inspecting each with Read. This
box centers her goggles/hair/face with headroom above the goggles and enough
chin/shoulder room that scaling up for the icon canvas doesn't feel clipped
(an earlier, tighter 220×220 box read as cropped once blown up to fill 86–94%
of a 512px canvas).

### Files added
- `app/icon.png` (512×512) — Next auto-wires this as the `<link rel="icon">`.
- `app/apple-icon.png` (180×180) — Next auto-wires `<link rel="apple-touch-icon">`.
- `app/favicon.ico` (16/32/48 multi-res) — bonus; Next also serves `icon.png`
  as a favicon fallback on its own, so this isn't load-bearing.
- `public/icons/nova-192.png`, `public/icons/nova-512.png` — manifest icons,
  `purpose: "any"`.
- `public/icons/nova-512-maskable.png` — manifest icon, `purpose: "maskable"`,
  face scaled to ~62% of the canvas (~19% safe-zone padding per side, above
  the ~10% minimum OS masking requires).
- `app/manifest.ts` — `MetadataRoute.Manifest`: name "Isaac Twin — Command
  Center", short_name "Nova", `display: "standalone"`, `start_url: "/"`,
  `background_color`/`theme_color: "#f2f2ef"`, the three icons above.

All non-maskable icons are composited onto solid `#F2F2EF` ("plate" — icons
must not be transparent for iOS) with a thin `#A61B1C` (oxbright) accent line
along the bottom edge (~2.8% of icon height) as a tasteful brand mark. The
generation script is at
`/private/tmp/claude-501/.../scratchpad/make_icons.py` (scratchpad, not
committed) if the crop/composite needs re-running.

### Middleware
`middleware.ts` matcher diff:
```diff
- matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.json).*)"],
+ // icon.png / apple-icon.png / manifest.webmanifest / icons/* are fetched by
+ // iOS/Android without cookies when adding to the home screen, so they must
+ // stay reachable unauthenticated or home-screen icons silently 307 to /login.
+ matcher: [
+   "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon.png|apple-icon.png|manifest.json|manifest.webmanifest|icons/).*)",
+ ],
```
Only the exclusion list changed — the middleware function body, `PUBLIC_PREFIXES`,
and auth logic are untouched. `manifest.json` (already excluded, unused) was
left in place; `manifest.webmanifest` was added since that's the actual path
Next serves `app/manifest.ts` at.

### `app/layout.tsx`
Added `appleWebApp: { capable: true, statusBarStyle: "default", title: "Nova" }`
to `metadata` so iOS standalone/home-screen mode behaves correctly. `title`/
`description`/`viewport` unchanged.

## Verification

- `npx tsc --noEmit` — clean, no errors.
- **Not run** (explicitly out of scope for this change): `next build`,
  `next dev`/`next start`, git operations. No visual/browser verification was
  performed — the reasoning above (grid auto-placement order, spacing math)
  is a static analysis of the Tailwind/CSS Grid semantics, not an observed
  screenshot.

### What the orchestrator should check
**Desktop (1360px, `lg`+):**
- Cockpit should look pixel-identical to before: 3 columns (Queue&Posted+KPI |
  Nova | Proposals+Positions+Inputs+Automations), Approval Queue full-width
  below, same ~24px gap above it as before.

**Mobile (375px):**
- Stacking order top-to-bottom: Nova (+ calibration card, now less overlapped)
  → Approval Queue → Queue & Posted / KPI → Positions/Inputs/Automations.
- Tap the platform tabs, APPROVE/REJECT/EDIT, calibration verdict buttons,
  SUBMIT/LATER, COPY/MARK POSTED — all should feel comfortably tappable
  (≥44px). Check a long draft body / long error toast doesn't cause
  horizontal scroll.

**Icons (unauthenticated fetches — use `curl -I` or an incognito tab, no
session cookie):**
```
curl -sI https://<host>/icon.png            # expect 200, image/png
curl -sI https://<host>/apple-icon.png      # expect 200, image/png
curl -sI https://<host>/favicon.ico         # expect 200
curl -sI https://<host>/icons/nova-192.png  # expect 200, image/png
curl -sI https://<host>/icons/nova-512.png  # expect 200, image/png
curl -sI https://<host>/icons/nova-512-maskable.png  # expect 200, image/png
curl -sI https://<host>/manifest.webmanifest         # expect 200, application/manifest+json (or json)
```
Then visually confirm `app/icon.png` reads as Nova's face at a glance — small
enough (e.g. resized to 32px) to check it isn't just a blur.

## Rollback
`git revert` the commit(s) covering this changelog. The new/untracked files
(`app/icon.png`, `app/apple-icon.png`, `app/favicon.ico`, `app/manifest.ts`,
`public/icons/`) will be removed by a revert of the commit that added them;
if they were never committed, `git status` will show them as untracked and
they can be deleted directly.
