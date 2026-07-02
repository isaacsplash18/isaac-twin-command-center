"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Signature element #2 (PRD §5.3): the app's "face" — a small rotating
 * particle constellation on a 2D canvas (~300 particles, no three.js).
 * Idle: slow drift. Approve: one pulse travels through it. Failure: a single
 * red stutter. Degrades to a static SVG on mobile / prefers-reduced-motion.
 */
export function TwinCore({ size = 88 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [staticMode, setStaticMode] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches; // phones: static per PRD §5.5
    setStaticMode(reduced || coarse);
  }, []);

  useEffect(() => {
    if (staticMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const N = 300;
    const R = size / 2 - 4;
    const cx = size / 2;
    const cy = size / 2;
    // Particles on a fuzzy sphere shell, rotated in 3D and projected.
    const pts = Array.from({ length: N }, () => {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = R * (0.55 + Math.random() * 0.45);
      return {
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.sin(phi) * Math.sin(theta),
        z: r * Math.cos(phi),
      };
    });

    let angle = 0;
    let pulse = -1; // 0..1 progress of an approve pulse sweeping through
    let stutter = 0; // frames of red stutter remaining
    let raf = 0;

    const onPulse = (e: Event) => {
      const kind = (e as CustomEvent).detail;
      if (kind === "approve") pulse = 0;
      else if (kind === "error") stutter = 14;
    };
    window.addEventListener("twin-pulse", onPulse);

    const draw = () => {
      angle += 0.0025;
      if (pulse >= 0) pulse = pulse > 1 ? -1 : pulse + 0.025;
      if (stutter > 0) stutter--;

      ctx.clearRect(0, 0, size, size);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const jitter = stutter > 0 && stutter % 4 < 2 ? 1.5 : 0;

      for (const p of pts) {
        const x = p.x * cosA - p.z * sinA;
        const z = p.x * sinA + p.z * cosA;
        const depth = (z + R) / (2 * R); // 0 far → 1 near
        const px = cx + x + (jitter ? (Math.random() - 0.5) * jitter * 2 : 0);
        const py = cy + p.y * 0.9;

        // Approve pulse: a bright band sweeping left → right
        const band = pulse >= 0 ? Math.abs((px - (cx - R)) / (2 * R) - pulse) : 1;
        const inBand = band < 0.08;

        ctx.fillStyle =
          stutter > 0
            ? `rgba(166,27,28,${0.25 + depth * 0.5})`
            : inBand
              ? `rgba(166,27,28,${0.5 + depth * 0.5})`
              : `rgba(232,232,227,${0.08 + depth * 0.3})`;
        const s = inBand ? 1.6 : 0.6 + depth * 0.9;
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("twin-pulse", onPulse);
    };
  }, [staticMode, size]);

  if (staticMode) {
    // Static SVG constellation — same silhouette, zero cost.
    const dots = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      const r = 12 + ((i * 7919) % 28);
      return { x: 44 + Math.cos(a) * r * 0.9, y: 44 + Math.sin(a) * r * 0.8, o: 0.12 + ((i * 31) % 10) / 30 };
    });
    return (
      <svg width={size} height={size} viewBox="0 0 88 88" aria-hidden className="shrink-0">
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r="0.8" fill="#E8E8E3" opacity={d.o} />
        ))}
        <circle cx="44" cy="44" r="2" fill="#A61B1C" opacity="0.8" />
      </svg>
    );
  }

  return <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden className="shrink-0" />;
}
