"use client";

import { useEffect, useRef, useState } from "react";

/**
 * NOVA — the twin's face: the actual Nova render (public/nova.png), recoloured
 * into the mission-control theme. She's framed to her face, desaturated to a
 * cool graphite hologram, edge-feathered so she dissolves into the ground, lit
 * with an oxblood rim glow (the scarcity accent), and overlaid with faint
 * scanlines. She breathes, tilts toward the cursor, blooms oxblood on Approve
 * and shudders red on failure. Pure CSS/DOM — no canvas, no deps.
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

  // Oval feather so she dissolves into the ground — no rectangle edge.
  const feather =
    "radial-gradient(ellipse 60% 68% at 50% 40%, #000 46%, rgba(0,0,0,0.6) 66%, transparent 100%)";

  return (
    <div className="flex flex-col items-center">
      <div ref={figureRef} style={{ width: size, height: size, willChange: "transform, filter" }}>
        <div style={reduced ? undefined : { animation: "nova-breathe 6s ease-in-out infinite" }}>
          <div
            className="relative"
            style={{
              width: size,
              height: size,
              WebkitMaskImage: feather,
              maskImage: feather,
            }}
          >
            {/* the portrait — framed to her face, cool graphite hologram */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "url(/nova.png)",
                backgroundSize: "205%",
                backgroundPosition: "40% 20%",
                backgroundRepeat: "no-repeat",
                filter: "grayscale(1) contrast(1.14) brightness(0.86)",
              }}
            />
            {/* faint oxblood rim light — the only tint; she stays graphite */}
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(105deg, rgba(${OXBRIGHT},0.18) 0%, rgba(${OXBRIGHT},0) 30%)`,
                mixBlendMode: "screen",
              }}
            />
            {/* deepen the base into the ground */}
            <div
              className="absolute inset-0"
              style={{ background: "linear-gradient(to bottom, transparent 55%, #0a0b0d 96%)" }}
            />
            {/* holographic scanlines */}
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: "repeating-linear-gradient(0deg, rgba(232,232,227,0.06) 0 1px, transparent 1px 4px)",
                mixBlendMode: "overlay",
              }}
            />
          </div>
        </div>
      </div>

      <NovaLine line={line} />

      <style>{`@keyframes nova-breathe {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }`}</style>
    </div>
  );
}

/** Typed speech line, mono, with a blinking cursor. Silent when blank. */
function NovaLine({ line }: { line: string }) {
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

  // When Nova is asking a calibration question, the floating card is her
  // voice — suppress the redundant caption entirely.
  if (!line.trim()) return null;

  return (
    <p className="mt-2 max-w-xl px-4 text-center font-mono text-[11px] leading-relaxed tracking-wider text-ink-dim">
      <span className="text-oxbright">NOVA //</span> {typed}
      <span className="animate-pulse text-oxbright">▍</span>
    </p>
  );
}
