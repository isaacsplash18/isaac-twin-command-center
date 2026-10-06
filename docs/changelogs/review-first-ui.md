# Review-first interface — 6 October 2026

The dashboard now opens on the work that needs a decision. Review, Schedule,
Train your twin, and More have dedicated views, with a visible command search
and mobile bottom navigation. Warm grey and oxblood remain the visual identity;
draft cards use solid reading surfaces, larger editorial text, and clearer actions.

- Nova is a compact companion in Review. The video is opt-in, and training has
  its own screen. The boot overlay and rotating dashboard ticker are no longer
  mounted in the daily workflow.
- Approval feedback follows a successful server response and respects each
  item's `autoPublish` configuration. Manual posts are copied explicitly from
  Schedule; approving no longer overwrites the clipboard.
- Rejection offers Cancel and explicitly labels rejection without feedback.
- Editing offers Save changes and Save & approve. The combined action saves
  before approving; failure preserves the editable draft and an inline error.
- Local search filters draft titles and bodies. Global search finds drafts,
  clears conflicting local filters, and focuses the selected draft.
- Fetch errors and partial source failures cannot appear as an all-clear queue.
  Retry controls and freshness messaging are visible.
- Schedule shows manual work, waiting-for-scheduler posts, scheduled posts,
  publishing issues, and recent history without a nested scrolling panel.
- Touch controls, keyboard focus, native-dialog search, notification
  announcements, and browser zoom support improve access.
- The performance view uses a simple rate and daily-approvals sparkline.
- Compatible dependency updates were applied within the existing Next.js 15
  range; this is not a framework-major migration.

## Verification

`npm run typecheck` and `npm run build` validate the source and production build.
`npm run test:ui` runs Playwright against a local fixture-only session. Install
Chromium with `npx playwright install chromium`, or use an installed Chrome with
`PLAYWRIGHT_CHANNEL=chrome npm run test:ui`.

Browser tests intercept all API calls and use local sample drafts. They do not
approve, reject, edit, or publish production content. They cover desktop/mobile
navigation, draft/body search, both publishing modes, rejection cancellation,
save-before-approve, standalone saving, errors/partial loads, and floating
controls for long mobile drafts. Production authentication and publishing
integrations retain their existing server behavior.
