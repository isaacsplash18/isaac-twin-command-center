# Liquid glass — implementation changelog

*Phases 1–2 of `docs/liquid-glass-plan.md`, implemented by a sonnet sub-agent
(8 July 2026). The agent was cut off by an API error while writing this file;
the orchestrator completed the changelog from the measured gate results. All
code below is the agent's; measurements are the orchestrator's.*

## Files changed

- `app/globals.css` — the `.glass` token system: translucent clay
  (`rgb(232 232 227 / 0.62)`), `backdrop-filter: blur(16px) saturate(1.4)`,
  specular top edge, refraction hairline, float shadow, diagonal sheen
  (`::after`, killed under `prefers-reduced-motion`). `@supports` fallback to
  opaque clay when `backdrop-filter` is unsupported. ≤640px media query drops
  to cheaper frost (8px blur, higher alpha) for mobile Safari perf.
  Note: the plan's literal `rgba(var(--tint), var(--alpha))` syntax was
  invalid CSS (comma + space syntax mix computes to transparent); the agent
  verified this in-browser and used the correct `rgb(var(--tint) / var(--alpha))`
  form — same intended value.
- `components/FrameCard.tsx` — `glass` prop (default **on**): every panel in
  the app frosts through the single choke point. `glass={false}` per card, or
  the default flip, is the global kill switch.
- `components/Ticker.tsx` — lighter glass variant (alpha 0.5, 10px blur) via
  CSS custom-property overrides.
- `components/CommandPalette.tsx` — the ⌘K sheet is a glass surface (the one
  place with rich content behind it to refract).
- `components/Nova.tsx` — liquid-glass specular sweep: a white diagonal band
  clipped to her silhouette by the existing alpha mask, translated by the yaw
  the pointer loop already computes, blooming with the approve glow. No new
  state, no new RAF loop; flat at 0.12 opacity under reduced motion.
- `components/BootSequence.tsx` + `components/LiquidSigil.tsx` (new) — the
  single WebGL moment: an oxblood-tinted liquid-metal sigil (via
  `@paper-design/shaders-react`'s `LiquidMetal`) above the boot line.
  `next/dynamic({ ssr: false })` so the shader chunk never loads unless the
  boot overlay actually mounts.
- `package.json` — `@paper-design/shaders-react` pinned **0.0.77**
  (**Apache-2.0**, installed as an npm dependency only — the liquid-logo
  GitHub repo is PolyForm-licensed and none of its source was copied).

## Budget gate (measured at orchestrator gate)

- Shader chunk `748.*.js`: **37.3KB raw, 11.8KB gzipped** — under the plan's
  45KB budget by ~4x.
- Lazy confirmed: not referenced by the main page bundle; `/` First Load JS
  155KB (was ~149KB before glass — the +6KB is the CSS system + dynamic-import
  scaffolding, not the shader).
- `npx tsc --noEmit` clean; `npx next build` clean.

## Verified in browser (orchestrator gate)

- 39 `.glass` panels at 1360px with computed `blur(16px) saturate(1.4)` and
  `rgba(232,232,227,0.62)` background; zero horizontal overflow.
- Mobile (375px) and boot-sigil verification recorded in the gate transcript.

## Phase 3 status

Deferred (per plan's own gating): the `liquid-glass-web-react` lens on the
⌘K palette and micro-interactions. Phases 1–2 landed within budget; phase 3
remains available as a later, separately-gated increment.

## Degradation matrix (as shipped)

- `prefers-reduced-motion`: sheen removed, Nova sweep flattens to static,
  boot (and thus the sigil) never mounts — existing behaviour.
- No WebGL / shader failure: `LiquidSigil` renders its static fallback.
- No `backdrop-filter` support: opaque clay panels (pre-glass look).
- ≤640px: cheaper frost automatically.

## Rollback

`git revert` the glass commit, or set `glass={false}` default in
`FrameCard.tsx` (kills all panel glass in one line) and remove the
`LiquidSigil` mount in `BootSequence.tsx`.
