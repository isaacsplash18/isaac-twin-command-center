"use client";

import { useEffect, useRef, useState } from "react";

/**
 * NOVA — the twin's face: a looping holographic video (public/nova-hologram.mp4)
 * of her floating in a dark command center. The clip's own background is
 * opaque and dark, but the page ground is light, so the wrapper carries a
 * feathered mask (radial + a heavier bottom fade) that dissolves her edges
 * into the ground instead of showing a hard video rectangle — same trick the
 * old alpha-cutout portrait used, just driven by a mask gradient instead of
 * the PNG's own alpha channel. She breathes, tilts toward the cursor, blooms
 * oxblood on Approve and shudders red on failure. Pure CSS/DOM — no canvas,
 * no deps.
 */

const OXBRIGHT = "166,27,28";

export type NovaMood = "praise" | "sass" | "neutral";

export function Nova({ mood, line }: { mood: NovaMood; line: string }) {
  const [size, setSize] = useState(400);
  const [reduced, setReduced] = useState(false);
  const figureRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const measure = () => setSize(Math.min(430, window.innerWidth - 40));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
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
      yaw = Math.max(-1, Math.min(1, nx)) * 7;
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
      fig.style.filter = `drop-shadow(0 0 ${10 + 20 * glowV}px rgba(${rgb},${0.1 + 0.35 * glowV}))`;
      fig.style.transform = `perspective(900px) rotateY(${yaw}deg) translateX(${shudder}px)`;
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

  // Feathered mask: fades all four edges (so the video rectangle never shows
  // a hard line), with the bottom pulled in further so the calibration card
  // in NovaStage overlaps a soft dissolve rather than a video edge.
  const featherMask =
    "linear-gradient(to bottom, transparent 0%, black 14%, black 52%, transparent 92%)," +
    "radial-gradient(ellipse 92% 88% at 50% 42%, black 62%, transparent 100%)";

  return (
    <div className="flex flex-col items-center">
      <div
        ref={figureRef}
        className="relative"
        style={{ width: size, height: size * 1.15, willChange: "transform, filter" }}
      >
        <div style={reduced ? undefined : { animation: "nova-breathe 6s ease-in-out infinite" }}>
          <div
            className="relative overflow-hidden rounded-[28px]"
            style={{
              width: size,
              height: size * 1.15,
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
