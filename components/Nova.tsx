"use client";

import { useEffect, useRef, useState } from "react";

/**
 * NOVA — the twin's face: the actual Nova render (public/nova.png), background
 * removed (real alpha cutout, not a photo crop) so she reads as a floating
 * presence rather than a framed photograph. In full colour now that the
 * ground is light. The same cutout doubles as a CSS mask on the wrapping
 * element, so the rim-light/scanline/ground-fade overlay layers clip to her
 * exact silhouette instead of painting a rectangle into the transparent
 * background around her. She breathes, tilts toward the cursor, blooms
 * oxblood on Approve and shudders red on failure. Pure CSS/DOM — no canvas,
 * no deps.
 */

const OXBRIGHT = "166,27,28";

export type NovaMood = "praise" | "sass" | "neutral";

export function Nova({ mood, line }: { mood: NovaMood; line: string }) {
  const [size, setSize] = useState(400);
  const [reduced, setReduced] = useState(false);
  const figureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const measure = () => setSize(Math.min(430, window.innerWidth - 40));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Base holographic glow by mood; pulses layer on top. Kept restrained — a
  // rim halo, not a red field (oxblood is the scarcity accent).
  const baseGlow = mood === "praise" ? 0.22 : mood === "sass" ? 0.04 : 0.08;

  useEffect(() => {
    const fig = figureRef.current;
    if (!fig) return;

    let yaw = 0;
    let glow = baseGlow;
    let glowTarget = baseGlow;
    let redUntil = 0;
    let shudderUntil = 0;
    let raf = 0;

    const onPointer = (e: PointerEvent) => {
      if (reduced) return;
      const rect = fig.getBoundingClientRect();
      const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2 || 1);
      yaw = Math.max(-1, Math.min(1, nx)) * 9;
    };
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
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("twin-pulse", onPulse);

    const apply = (glowV: number, red: boolean, shudder: number) => {
      const rgb = red ? "220,40,40" : OXBRIGHT;
      fig.style.filter = `drop-shadow(0 0 ${7 + 15 * glowV}px rgba(${rgb},${0.08 + 0.3 * glowV}))`;
      fig.style.transform = `perspective(800px) rotateY(${yaw}deg) translateX(${shudder}px)`;
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
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("twin-pulse", onPulse);
    };
  }, [baseGlow, reduced]);

  // The cutout's own alpha channel, reused as a CSS mask so the overlay
  // layers (rim light, ground-fade, scanlines) clip to her real silhouette
  // instead of showing as a rectangle in the now-transparent background.
  const portraitFrame = {
    backgroundImage: "url(/nova.png)",
    backgroundSize: "320%",
    backgroundPosition: "46% 16%",
    backgroundRepeat: "no-repeat",
  } as const;

  return (
    <div className="flex flex-col items-center">
      <div
        ref={figureRef}
        className="relative"
        style={{ width: size, height: size, willChange: "transform, filter" }}
      >
        <div style={reduced ? undefined : { animation: "nova-breathe 6s ease-in-out infinite" }}>
          <div
            className="relative"
            style={{
              width: size,
              height: size,
              WebkitMaskImage: portraitFrame.backgroundImage,
              maskImage: portraitFrame.backgroundImage,
              WebkitMaskSize: portraitFrame.backgroundSize,
              maskSize: portraitFrame.backgroundSize,
              WebkitMaskPosition: portraitFrame.backgroundPosition,
              maskPosition: portraitFrame.backgroundPosition,
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
            }}
          >
            {/* the portrait itself, full colour now the ground is light —
                just a light polish, no grayscale/darkening */}
            <div className="absolute inset-0" style={{ ...portraitFrame, filter: "contrast(1.04) saturate(1.06)" }} />
            {/* faint oxblood rim light — kept subtle so it reads as a glow
                accent, not a colour cast over her actual colours */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(105deg, rgba(${OXBRIGHT},0.12) 0%, rgba(${OXBRIGHT},0) 26%)`,
                mixBlendMode: "screen",
              }}
            />
            {/* deepen the base into the ground — matches the page ground
                token so she fades into the actual surface, not a hardcoded
                dark patch (breaks if the theme's ground colour changes) */}
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to bottom, transparent 55%, var(--color-ground) 96%)" }}
            />
            {/* holographic scanlines */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "repeating-linear-gradient(0deg, rgba(25,26,28,0.05) 0 1px, transparent 1px 4px)",
                mixBlendMode: "multiply",
              }}
            />
          </div>
        </div>

        {/* speaking overlay — sits on the portrait itself, outside the feather
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
 * Typed speech line, overlaid directly on the lower portrait — like she's
 * speaking it, not a caption underneath the image. A dark scrim (oval, so it
 * doesn't read as a hard rectangle against the feathered portrait) keeps the
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
    <div className="pointer-events-none absolute inset-x-0 bottom-[9%] flex justify-center px-6">
      {/* A self-contained caption chip, not a scrim bleeding across the box —
          she's a floating cutout now (transparent background), so anything
          wider than the text itself would show as a stray rectangle rather
          than blending into a photo edge. Colour pinned to Splash "clay"
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
