"use client";

import { useEffect, useRef, useState } from "react";

/**
 * NOVA — the twin's face: a looping holographic video (public/nova-hologram.mp4)
 * of her floating in a dark command center. The clip's own background is
 * opaque and dark, but the page ground is light, so the wrapper carries a
 * feathered mask (a tall, figure-biased radial ellipse + a heavier bottom
 * fade) that dissolves her edges into the ground on every side — no card,
 * no frame, no visible rectangle — same trick the old alpha-cutout portrait
 * used, just driven by a mask gradient instead of the PNG's own alpha
 * channel. She breathes gently, blooms oxblood on Approve and shudders red
 * on failure. Pure CSS/DOM — no canvas, no deps, no video processing (the
 * clip itself stays fully opaque and untouched).
 */

const OXBRIGHT = "166,27,28";

export type NovaMood = "praise" | "sass" | "neutral";

export function Nova({ mood, line }: { mood: NovaMood; line: string }) {
  const [reduced, setReduced] = useState(false);
  const figureRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
  }, []);

  // Reduced motion: hold on a single frame instead of autoplaying — never
  // blank, just static. Seek past frame 0 since some encodes start on black.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !reduced) return;
    v.pause();
    const onMeta = () => {
      v.currentTime = 0.1;
    };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [reduced]);

  // Base holographic glow by mood; pulses layer on top. Kept restrained — a
  // rim halo, not a red field (oxblood is the scarcity accent).
  const baseGlow = mood === "praise" ? 0.22 : mood === "sass" ? 0.04 : 0.08;

  useEffect(() => {
    const fig = figureRef.current;
    if (!fig) return;

    let glow = baseGlow;
    let glowTarget = baseGlow;
    let redUntil = 0;
    let shudderUntil = 0;
    let raf = 0;

    const onPulse = (e: Event) => {
      const kind = (e as CustomEvent).detail;
      const now = performance.now();
      if (kind === "approve") glowTarget = 1;
      else if (kind === "error") {
        redUntil = now + 800;
        shudderUntil = now + 600;
        glowTarget = 1;
      }
    };
    window.addEventListener("twin-pulse", onPulse);

    // No cursor-driven tilt here — just the mood glow and the error shudder.
    // A perspective/rotateY transform was removed on purpose: it made the
    // whole figure read as a rigid slab tilting toward the pointer (the
    // "plate" look), which fought the feathered, edgeless framing below.
    const apply = (glowV: number, red: boolean, shudder: number) => {
      const rgb = red ? "220,40,40" : OXBRIGHT;
      fig.style.filter = `drop-shadow(0 0 ${10 + 20 * glowV}px rgba(${rgb},${0.1 + 0.35 * glowV}))`;
      fig.style.transform = `translateX(${shudder}px)`;
    };

    const tick = (t: number) => {
      glowTarget += (baseGlow - glowTarget) * 0.04;
      glow += (glowTarget - glow) * 0.12;
      const red = t < redUntil;
      const shudder = t < shudderUntil ? (Math.random() - 0.5) * 5 : 0;
      apply(glow, red, shudder);
      raf = requestAnimationFrame(tick);
    };
    if (reduced) apply(baseGlow, false, 0);
    else raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("twin-pulse", onPulse);
    };
  }, [baseGlow, reduced]);

  // Feathered mask: a tall, figure-biased radial ellipse centered on her
  // upper body reaches full transparency well before the frame edges, so no
  // straight edge or corner ever shows — she dissolves into the ground
  // instead of sitting inside a frame. Intersected with a top-to-bottom
  // gradient whose fade starts around the midpoint, giving the bottom a
  // heavier melt so the calibration card in NovaStage overlaps a soft
  // dissolve rather than a video edge. Cropped loosely enough that her head
  // and shoulders are never clipped — only the empty dark margins vanish.
  const featherMask =
    "linear-gradient(to bottom, transparent 0%, black 12%, black 46%, transparent 86%)," +
    "radial-gradient(ellipse 70% 84% at 50% 40%, black 52%, transparent 96%)";

  return (
    <div className="flex w-full flex-col items-center">
      <div
        ref={figureRef}
        className="relative w-full"
        style={{
          // Fluid width — fills whatever box she's given (full-bleed on
          // mobile, the centre grid column on desktop) instead of a capped
          // pixel size. Height rides the clip's portrait crop via
          // aspect-ratio (same 1:1.15 proportion the old fixed px used, so
          // the feather mask below needs no retuning — it's percentage-based
          // and scales with the box). Capped at 90vh so a very wide desktop
          // column doesn't produce an absurdly tall figure; object-fit:cover
          // on the video means the cap never distorts or letterboxes her.
          aspectRatio: "1 / 1.15",
          maxHeight: "90vh",
          willChange: "transform, filter",
        }}
      >
        <div
          className="h-full w-full"
          style={reduced ? undefined : { animation: "nova-breathe 6s ease-in-out infinite" }}
        >
          <div
            className="relative h-full w-full overflow-hidden"
            style={{
              WebkitMaskImage: featherMask,
              maskImage: featherMask,
              WebkitMaskComposite: "source-in",
              maskComposite: "intersect",
            }}
          >
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full"
              style={{ objectFit: "cover", objectPosition: "center" }}
              src="/nova-hologram.mp4"
              muted
              loop
              playsInline
              autoPlay={!reduced}
              preload="auto"
              aria-label="Nova — the twin's holographic presence"
            />
            {/* deepen into the ground at the very bottom — matches the page
                ground token so she fades into the actual surface, not a
                hardcoded dark patch (breaks if the theme's ground colour
                changes); layers under the mask's own fade for a longer melt
                where the calibration card overlaps. */}
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to bottom, transparent 55%, var(--color-ground) 96%)" }}
            />
            {/* faint oxblood rim light, restrained so it reads as a glow
                accent over the hologram's own cyan/teal shading */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(105deg, rgba(${OXBRIGHT},0.1) 0%, rgba(${OXBRIGHT},0) 26%)`,
                mixBlendMode: "screen",
              }}
            />
          </div>
        </div>

        {/* speaking overlay — sits above the video, outside the feather
            mask, so the caption stays crisp as she "speaks" it. Hidden
            entirely while a calibration question card is up (line is blank
            then; the card is her voice at that point). */}
        <NovaCaption line={line} />
      </div>

      <style>{`@keyframes nova-breathe {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }`}</style>
    </div>
  );
}

/**
 * Typed speech line, overlaid directly on the lower video — like she's
 * speaking it, not a caption underneath the image. A dark scrim keeps the
 * mono text legible over her. Silent when blank — the calibration card takes
 * over as her voice while a question is up.
 */
function NovaCaption({ line }: { line: string }) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(line);
      return;
    }
    setTyped("");
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setTyped(line.slice(0, i));
      if (i >= line.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [line]);

  if (!line.trim()) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[9%] z-10 flex justify-center px-6">
      {/* A self-contained caption chip, not a scrim bleeding across the box —
          she's a floating hologram now (feathered edges), so anything wider
          than the text itself would show as a stray rectangle rather than
          blending into the video edge. Colour pinned to Splash "clay"
          regardless of the page theme, since this chip is deliberately dark
          — she's a lit screen, like captions on a video. */}
      <p
        className="relative max-w-[88%] rounded px-3 py-1.5 text-center font-mono text-[11px] leading-relaxed tracking-wider text-[#e8e8e3]"
        style={{ background: "rgba(6,7,8,0.82)" }}
      >
        <span className="text-oxbright">NOVA //</span> {typed}
        <span className="animate-pulse text-oxbright">▍</span>
      </p>
    </div>
  );
}
