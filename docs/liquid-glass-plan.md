# Liquid Glass / Liquid Metal — Visual Upgrade Plan

Design + implementation spec for giving the Isaac Twin Command Center a
liquid‑glass / liquid‑metal treatment **without trashing the Splash Co.
discipline**. Written for a separate implementation agent — precise enough to
execute without re‑researching.

> TL;DR direction: **Frosted instrument glass everywhere (pure CSS, cross‑browser)
> + one WebGL liquid‑metal centrepiece (an oxblood sigil, not Nova's face).**
> Nova's photographic identity is preserved. No per‑panel SVG refraction, no
> three.js / R3F. "Restraint is the luxury" holds — glass is the finish on the
> existing instrument panel, not a new theme.

---

## 1. Research findings

### 1.1 "liquid‑glass‑js" → **`liquid-glass-web-react`** (chosen) / the SVG‑displacement family

There is no single canonical "liquid-glass-js". It's a genre of libraries that
recreate Apple's iOS 26 Liquid Glass with **SVG `feDisplacementMap` + `backdrop-filter`**.
The relevant candidates:

| Repo / package | License | Size | Technique | Safari? |
|---|---|---|---|---|
| **`liquid-glass-web-react`** (PallavAg) | **MIT** | **~5 KB min+gz, zero deps** (npm v0.1.1, unpacked 189 KB) | Generates a displacement‑map PNG, feeds `feDisplacementMap` applied to the **element's own rendered pixels** via `filter:url(#…)` (not `backdrop-filter:url()`). 3‑pass RGB split for chromatic aberration. | **Yes** — Chrome/Safari/FF, desktop+mobile, no flags. iOS auto‑switches to `userSpaceOnUse`. |
| `samasante/liquid-glass` | MIT | headless, small | Same `filter:url()`‑on‑element approach, refracts live DOM behind it | Yes |
| `nikdelvin/liquid-glass` | MIT | small | Pure CSS + `backdrop-filter:url(#svg)` | **No** — Safari silently falls back to plain blur (`backdrop-filter:url()` is Chromium‑only) |

**Critical browser fact (drives the whole design):** genuine *backdrop* refraction
(`backdrop-filter: url(#displacement)`) is **Chromium‑only**. It does **not** work in
Safari / iOS — our primary target (PWA on iPhone). The cross‑browser libraries
achieve refraction by displacing the **element's own content**, i.e. a lens over an
image, **not** a frosted panel over a background. `backdrop-filter: blur()` (plain
frost, no `url()`) **is** supported in Safari and is the only cross‑browser way to get
a "glass panel over the app" read.

→ **We install `liquid-glass-web-react` (MIT, 5 KB)** and use it only where there is
real content to refract (the ⌘K palette lens, phase 3). Panels use **pure‑CSS frosted
glass** (§3.1), which is cross‑browser and near‑free.

### 1.2 "liquid‑logo" → **`@paper-design/shaders-react` `LiquidMetal`** (engine is the real dependency)

- **The `liquid-logo` repo itself** (paper-design/liquid-logo) is **`PolyForm Shield
  License 1.0.0`** (source‑available, *non‑compete* — not OSS) and **`private: true`,
  unpublished to npm**. **Do NOT vendor or copy it.**
- **The engine it uses is OSS and published:** `@paper-design/shaders-react`
  (**Apache‑2.0**, npm v0.0.77, unpacked 410 KB) depending on `@paper-design/shaders`
  (**Apache‑2.0**, zero runtime deps, unpacked 819 KB). Peer deps: `react ^18||^19`
  (we're on React 19 ✓).
- **Renderer: raw WebGL2 on a plain `<canvas>` via a `ShaderMount` class — NOT three.js.**
  "Zero‑dependency canvas shaders." This is the single most important architectural
  finding: **the liquid‑metal effect needs no three.js and therefore no R3F.**
- **API — `<LiquidMetal>`** props & defaults: `image:''`, `colorBack:'#AAAAAC'`,
  `colorTint:'#ffffff'`, `speed:1`, `frame:0`, `softness:0.1`, `repetition:2.0`,
  `shiftRed:0.3`, `shiftBlue:0.3`, `distortion:0.07`, `contour:0.4`, `angle:70`,
  `shape:'diamond'` (also `circle`/`daisy`/`metaballs`/`none`), `scale:0.6`, plus
  `fit/rotation/offsetX/offsetY/worldWidth/worldHeight`, and
  `suspendWhenProcessingImage:false`.
- **Custom image:** pass a PNG/URL to `image`; the component internally runs
  `toProcessedLiquidMetal()` (encodes an edge/height field from the image's **alpha
  channel**) and swaps in a processed blob. **It wants an alpha cutout** — and we
  already have `public/nova.png` (a true alpha cutout) plus we can generate a small
  monogram PNG. The metal flows *inside the opaque region* and ripples along the alpha
  edge.
- **Attribution:** Apache‑2.0 → keep the license/notice; no visible‑attribution
  requirement. Preferred over vendoring per the brief.

### 1.3 `@react-three/fiber` — **assessed, rejected for this app**

R3F is the React reconciler for three.js. It's the right tool for real 3D scenes
(meshes, lights, cameras, GLTF). Here we have **no 3D scene** — liquid metal is a 2D
fragment shader (paper handles it in raw WebGL2), liquid glass is SVG/CSS. Adding R3F
would pull **three.js (~150 KB gz core) + fiber (~40 KB gz)** for zero benefit, and put
a heavy WebGL renderer on the iPhone's critical path. **Do not install R3F or three.js.**
(If a future roadmap wants a genuine 3D Nova bust or a particle field, revisit — scoped
to one `next/dynamic(ssr:false)` `<Canvas>`. Not now.)

---

## 2. Design direction (one opinionated pick)

**"Frosted instrument glass, one liquid centrepiece."**

The Splash light ground is nearly flat — ground `#F2F2EF` vs panel `#E8E8E3` is ~6% of
luminance apart. Real liquid‑glass *refraction* needs high‑contrast content behind the
glass to bend; on this flat ground it would be **invisible and expensive**. So we
interpret "liquid glass" honestly for a light theme:

1. **Panels become frosted instrument glass** (FrameCard evolution, §3.1): translucent
   clay + `backdrop-filter: blur+saturate`, a **bright 1px specular top edge**, a soft
   float shadow, and a faint diagonal sheen. Cross‑browser, ~free, restyles the whole
   app from the single FrameCard choke point. The border‑trace mount animation and frame
   corners **stay** — glass sits *under* them.
2. **One true WebGL liquid‑metal moment — an oxblood sigil, not Nova's face.** A small
   `LiquidMetal` canvas (oxblood‑tinted chrome, `diamond`/monogram alpha) is the brand
   mark: full‑bleed behind the **boot sequence**, and a persistent **40 px mark in the
   header**. This delivers the "liquid metal" spectacle in a place that reinforces
   identity and costs one tiny canvas.
3. **Nova stays photographic** + gains a **CSS liquid‑glass specular sweep** and a
   refractive rim that tracks her existing pointer‑yaw (no WebGL, reuses the RAF loop she
   already runs). Her face is load‑bearing identity — we do **not** replace it with chrome
   or distort it through a lens.
4. **One liquid‑glass lens where refraction actually reads:** the ⌘K **Command Palette**,
   which floats over a dimmed snapshot of the real dashboard (genuine content to refract).
   Phase 3, optional.

**Untouched (hard):** typography (Schibsted/Newsreader/Plex Mono), content hierarchy,
the Newsreader body‑as‑hero, oxblood **scarcity** (still only accent/approve/error/scarce
counts — glass never adds oxblood fields), the 8px grid, phone‑first layout, 44px targets,
`prefers-reduced-motion` kills, the approve/reject buttons' solid high‑contrast fills
(glanceability > spectacle).

---

## 3. Implementation spec (file by file, literal values)

### 3.1 `app/globals.css` — the frosted‑glass system (do this first)

Add glass tokens + a `.glass` utility. This is the phase‑1 payload; everything else
consumes it.

```css
@theme {
  /* glass tokens (additive — existing tokens unchanged) */
  --glass-tint: 232 232 227;        /* = panel #E8E8E3 as RGB channels */
  --glass-alpha: 0.62;              /* panel translucency on desktop */
  --glass-blur: 16px;
  --glass-saturate: 1.4;
  --glass-specular: rgba(255,255,255,0.65);  /* top-edge highlight */
  --glass-edge: rgba(25,26,28,0.06);         /* refraction hairline */
}

/* Frosted instrument glass. Applied by FrameCard's root. */
.glass {
  background: rgba(var(--glass-tint), var(--glass-alpha));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  box-shadow:
    inset 0 1px 0 var(--glass-specular),      /* specular top edge */
    inset 0 0 0 1px var(--glass-edge),         /* refraction hairline */
    0 1px 2px rgba(25,26,28,0.04),
    0 10px 28px -14px rgba(25,26,28,0.14);     /* float */
}
/* faint diagonal sheen — the "wet" read; pointer-events:none */
.glass::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 38%);
  mix-blend-mode: screen;
}

/* No-backdrop-filter fallback (old browsers): opaque clay, no glass. */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--color-panel); }
}

/* Mobile perf: cheaper frost so many simultaneous panels don't jank iOS. */
@media (max-width: 640px) {
  .glass {
    --glass-blur: 8px; --glass-alpha: 0.78; --glass-saturate: 1.2;
  }
}

/* Reduced motion: kill the sheen (static), keep the frost. */
@media (prefers-reduced-motion: reduce) {
  .glass::after { display: none; }
}
```

Notes for the implementer:
- The `.glass` element **must be `position: relative; overflow: hidden`** for `::after`
  and the inset specular to clip — FrameCard's root already is (`relative overflow-hidden`).
- Keep the existing `bg-panel` class **off** glassy FrameCards (glass sets its own bg);
  see §3.2.

### 3.2 `components/FrameCard.tsx` — glass variant (single choke point)

Add an opt‑out‑able `glass` prop (default **true**), swap `bg-panel` for the `.glass`
class when on. Everything else (border‑trace spans, corners, sweep, content fade) is
unchanged and now renders *over* glass.

```tsx
export function FrameCard({
  children, index = 0, className = "", sweep = false, glass = true,
}: {
  children: ReactNode; index?: number; className?: string;
  sweep?: boolean; glass?: boolean;
}) {
  // ...unchanged...
  return (
    <motion.div
      /* ...unchanged initial/animate/exit... */
      className={`relative overflow-hidden ${glass ? "glass" : "bg-panel"} ${className}`}
    >
      {/* border-trace spans, corners, sweep, content — ALL unchanged */}
    </motion.div>
  );
}
```

- **Do not** apply glass to the oxblood approve **sweep** overlay or the approve/reject
  **buttons** — they must stay opaque/high‑contrast (10‑second flow). No change needed;
  the sweep sits at `z-10` above glass and the buttons are inside content.
- Panels that pass a solid `bg-*` in `className` (none currently do) would need `glass={false}`.
- `bg-panel/80` headers/tickers in `CommandCenter.tsx` / `Ticker.tsx` are **not** FrameCards
  — treat separately (§3.4).

### 3.3 `components/Nova.tsx` — CSS liquid‑glass specular (no WebGL)

Keep the photographic cutout + mask + existing RAF loop. **Add** a specular glass sweep
layer inside the masked stack (so it clips to her silhouette) and drive its position from
the yaw the loop already computes.

1. Add one overlay `<div>` as the **top** layer of the masked stack (after scanlines):
   ```tsx
   {/* liquid-glass specular sweep — clipped to her silhouette by the mask */}
   <div ref={specRef} className="absolute inset-0" style={{
     background:
       "linear-gradient(105deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 62%)",
     mixBlendMode: "screen",
     opacity: 0.0,                 // raised on approve pulse, see below
     transform: "translateX(0%)",
     willChange: "transform, opacity",
   }} />
   ```
2. In the existing `apply()` inside the RAF loop, move the sweep with yaw and bloom it on
   approve (reuse `glowV`):
   ```ts
   if (specRef.current) {
     specRef.current.style.transform = `translateX(${yaw * 2.2}%)`;
     specRef.current.style.opacity = String(0.12 + 0.5 * glowV); // subtle idle, blooms on approve
   }
   ```
3. `prefers-reduced-motion`: leave opacity at a flat `0.12`, no transform (the loop already
   short‑circuits under `reduced`).

Net: Nova reads like a figure behind glass; approve = a specular wipe across her. Zero deps,
zero bundle, reuses her loop. **Rejected:** running her through `liquid-glass-web-react`'s
lens (distorts her face) or `LiquidMetal` (replaces her face with chrome) — both destroy
identity. See §7.

### 3.4 Header / ticker / palette / toasts polish

- **Header** (`CommandCenter.tsx`, `bg-panel/80`): change to the glass utility inline —
  `className="… border-b border-hairline glass"` and drop `bg-panel/80`. Add the
  liquid‑metal **header mark** (§3.5) to the right cluster, left of the LOCK button, at 28–32 px.
- **Ticker** (`Ticker.tsx`, `bg-panel/60`): swap to `glass` but with a lighter tint —
  add class `glass` and inline `style={{ ["--glass-alpha" as any]: 0.5, ["--glass-blur" as any]: "10px" }}`.
  It's a thin strip; keep blur modest.
- **Command Palette** (`CommandPalette.tsx`): the dialog `bg-panel` → `glass` for the frosted
  card; keep the `bg-black/60` scrim. **Phase 3 upgrade:** wrap the dialog in
  `liquid-glass-web-react` `<LiquidGlass>` so it refracts the dimmed dashboard behind it —
  this is the one place backdrop content is rich enough to justify real refraction. Guard with
  `prefers-reduced-motion` (fall back to plain `.glass`).
- **Toasts** (`CommandCenter.tsx`): `bg-panel` → `glass` + keep `border-oxbright/50`. They sit
  over content at `z-[95]`; frost reads well there.
- **Publish‑failure / error banners:** leave as‑is (oxblood/amber tint must stay legible —
  do **not** frost warnings).

### 3.5 Liquid‑metal sigil — `components/LiquidSigil.tsx` (new, lazy)

The one WebGL moment. A tiny oxblood‑tinted chrome mark.

```tsx
"use client";
import { LiquidMetal } from "@paper-design/shaders-react";

export default function LiquidSigil({ size = 32 }: { size?: number }) {
  return (
    <LiquidMetal
      style={{ width: size, height: size }}
      colorBack="#00000000"           /* transparent — sits over glass/ground */
      colorTint="#A61B1C"             /* oxbright — the scarcity accent, used once, on purpose */
      shape="diamond"                 /* or image="/sigil.png" for a monogram alpha cutout */
      speed={0.6} softness={0.2} repetition={2} distortion={0.08} contour={0.5}
    />
  );
}
```

Mounting (both lazy, `ssr:false`, so WebGL/shaders stay out of the main bundle and SSR):
```tsx
// in CommandCenter.tsx header cluster and BootSequence.tsx
const LiquidSigil = dynamic(() => import("./LiquidSigil"), {
  ssr: false,
  loading: () => <span style={{ width: 32, height: 32, display: "inline-block" }} />,
});
```

- **Header:** persistent 28–32 px mark. **Boot sequence:** a ~160 px centred mark above the
  typed line, unmounts with the boot overlay (<1.2 s) so its canvas is torn down.
- **`prefers-reduced-motion`:** render `speed={0}` (one static frame) — or skip the import and
  show a static `/sigil.png`. Detect via `matchMedia` at mount.
- **Optional (not default): a Nova "pedestal"** — a wide, short `LiquidMetal` bar (oxblood,
  `shape:'none'`, low contour) under Nova as a reflective plinth. Only if header+boot feel too
  sparse; adds a second canvas, so keep off unless measured fine on device.

### 3.6 Dark‑glass edge cases on the light ground

- The existing **Nova caption chip** (`rgba(6,7,8,0.82)`, deliberately dark) and **boot overlay**
  (`bg-ground`) are intentionally opaque — **leave un‑glassed**; frost on a dark chip over a
  light figure muddies text.
- Glass panels sitting directly on the flat ground have little to refract — the **specular edge +
  translucency + float shadow** carry the read (that's why the recipe leans on the inset highlight,
  not on backdrop content). Where panels overlap (mobile stacked cards, `AnimatePresence`
  popLayout), the blur picks up the neighbour beneath — a genuine glass moment; verify it doesn't
  smear during the exit sweep (it won't — sweep is `z-10` opaque).
- Selection color, scanlines grid: unchanged; the grid shows *through* frosted panels faintly,
  which is on‑brand ("instrument, not neon").

---

## 4. Performance + degradation matrix

| Concern | Behaviour |
|---|---|
| **Bundle — CSS glass (phase 1)** | ~0 KB JS. Pure CSS. No dep. |
| **Bundle — `liquid-glass-web-react` (phase 3)** | **~5 KB min+gz**, zero deps, only imported by the palette. Tree‑shaken; not on first paint. |
| **Bundle — `@paper-design/shaders-react` (phase 2)** | Apache‑2.0, raw WebGL2 (no three). **Must be `next/dynamic(ssr:false)`** so it's a separate chunk. Budget: **target < 45 KB gz added**, lazy, off the critical path. **Measure the actual chunk** (`next build` → `.next` analyze) before shipping; if the one‑shader import exceeds budget, keep the sigil **boot‑only** (loads then unmounts) and use a static PNG in the header. |
| **Mobile (≤640px)** | `.glass` auto‑drops to `blur(8px)`, `alpha 0.78`, `saturate 1.2` (fewer GPU layers). Sigil renders at small size; **at most one live canvas on mobile** (header mark only; boot canvas has already unmounted). Consider `glass={false}` on the 2nd‑column side panels if FPS dips (they're below the fold). |
| **`prefers-reduced-motion`** | Sheen `::after` hidden (static frost kept). Nova sweep flat at 0.12. Sigil `speed=0` (static) or static PNG. Boot already skipped. |
| **Safari / iOS** | `backdrop-filter: blur()` **works** (frost is fine). `backdrop-filter: url()` **not used** anywhere (would silently no‑op). `liquid-glass-web-react` uses `filter:url()` on‑element → works. WebGL2 LiquidMetal works on modern iOS Safari. `-webkit-backdrop-filter` prefix included. |
| **PWA standalone** | No change — all client‑side. `themeColor #f2f2ef` unchanged. Verify glass over the standalone status bar area is fine (header is glass, not transparent). |
| **FPS risk points** | (1) Many simultaneous `backdrop-filter` panels on a scrolling mobile list — mitigated by cheaper mobile frost + optional `glass={false}` on side panels. (2) Two live WebGL canvases — mitigated by boot canvas unmounting. (3) Nova sweep runs in her existing RAF (no new loop). |

---

## 5. Phased build order (for the implementation agent)

Each phase = **one commit**, independently revertable. Verify before moving on.

### Phase 1 — Pure‑CSS frosted glass (no deps, no install)
1. Add the `.glass` system + tokens to `globals.css` (§3.1).
2. Add `glass` prop to `FrameCard` (§3.2).
3. Glass the header, ticker, palette card, toasts (§3.4, CSS only — skip the `<LiquidGlass>` lens).
4. Nova CSS specular sweep (§3.3).
- **Verify:** `next dev`; screenshot at **375px** and **1360px**. Check: (a) panels read as
  frosted glass with a bright top edge and float shadow; (b) border‑trace + corners still animate
  over glass; (c) approve/reject buttons still solid/high‑contrast; (d) no horizontal overflow at
  375; (e) toggle `prefers-reduced-motion` → sheen gone, frost stays; (f) DevTools mobile Safari
  emulation → frost present (not opaque fallback). Measure: Lighthouse/Perf — no long tasks added.

### Phase 2 — Liquid‑metal centrepiece (install `@paper-design/shaders-react`)
1. `npm i @paper-design/shaders-react` (Apache‑2.0). *(Install is the implementer's step, not this
   plan's.)*
2. Create `LiquidSigil.tsx` (§3.5); wire `next/dynamic(ssr:false)` mounts in header + boot.
3. (Optional) generate `public/sigil.png` monogram alpha cutout if not using `shape:'diamond'`.
4. reduced‑motion + static‑PNG fallback.
- **Verify:** `next build` → confirm shaders land in a **separate lazy chunk** (not the main bundle);
  record the gz size vs the <45 KB budget. Screenshot boot (sigil present, unmounts) and header mark
  at 375/1360. Confirm oxblood tint reads as *accent*, not a new colour field. On a real iPhone if
  possible: header canvas smooth, no heat/jank. reduced‑motion → static.

### Phase 3 — Micro‑interactions & the real lens (optional polish)
1. `npm i liquid-glass-web-react` (MIT, 5 KB); wrap the Command Palette dialog in `<LiquidGlass>`
   so it refracts the dimmed dashboard (fallback to `.glass` under reduced‑motion).
2. Tune Nova sweep bloom on approve; consider the optional Nova pedestal (§3.5) **only if measured fine**.
- **Verify:** ⌘K over a populated dashboard at 1360 → visible refraction of the content behind; at
  375 no overflow, still legible; reduced‑motion → plain frost. Re‑measure bundle (+5 KB, lazy).

---

## 6. Non‑goals + rollback

**Non‑goals (do not do):**
- No dark theme / no changing the Splash light palette.
- No per‑panel SVG **displacement/refraction** (invisible on the flat ground, costly).
- No three.js, no `@react-three/fiber`.
- No vendoring `paper-design/liquid-logo` source (PolyForm Shield, non‑compete, unpublished) — use
  the Apache‑2.0 npm engine only.
- Do not liquid‑metal or lens **Nova's face**; do not frost warning banners, the Nova caption chip,
  the boot overlay, or the approve/reject buttons.
- No new oxblood fields — the metal sigil is the *one* sanctioned extra oxblood, used as accent.
- Don't touch typography, content hierarchy, layout grid, 44px targets, or the 10‑second approve flow.

**Rollback:**
- Phase‑per‑commit → `git revert <phase-commit>` cleanly backs out one layer.
- Component‑level kill switch: `FrameCard`'s `glass` prop defaults true — set false (or add
  `GLASS_ENABLED` const gating the class) to drop all panel glass instantly without reverting.
- WebGL is isolated in `LiquidSigil.tsx` behind `next/dynamic` — deleting the two mount sites removes
  it with zero effect on the rest of the app; static PNG is the drop‑in fallback.
- `@supports` fallback already degrades glass → opaque clay on unsupported browsers automatically.

---

## 7. Rejected alternatives (one‑liners)

- **Liquid‑metal on Nova's face** — replaces the real photographic Nova with chrome; kills identity.
- **`liquid-glass-web-react` lens over Nova** — distorts her face; refraction only flatters flat UI, not a portrait.
- **`backdrop-filter: url(#displacement)` real glass on panels** — Chromium‑only, dead on iOS Safari (our target).
- **R3F / three.js** — ~190 KB gz for a 2D shader that paper renders in raw WebGL2; wrong tool.
- **Vendoring `liquid-logo`** — PolyForm Shield (non‑compete) + unpublished; use Apache‑2.0 engine instead.
- **`seangeng/argent`** (pure CSS+SVG liquid metal, no WebGL) — viable zero‑bundle fallback for the sigil
  if phase‑2 bundle/FPS proves unacceptable on device; note as the contingency, not the default.
- **Glassing every surface incl. buttons/warnings** — trades the 10‑second glanceability the command
  center exists for; glass is the finish, not the function.
```

Sources: [liquid-glass-web-react](https://github.com/PallavAg/liquid-glass-web-react), [paper-design/shaders](https://github.com/paper-design/shaders), [paper-design/liquid-logo](https://github.com/paper-design/liquid-logo), [Paper Shaders — Liquid Metal](https://shaders.paper.design/liquid-metal), [seangeng/argent](https://github.com/seangeng/argent).
