"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Signature element #2 (PRD §5.3): the app's "face" — a holographic
 * point-cloud head, Cortana-style (scan-line shimmer, hologram glitches),
 * rendered in the app's oxblood/ink palette on a plain 2D canvas.
 *
 * Technique per the hologram-shader / particle-morph references
 * (threejs-journey hologram lesson, mmdalipour/particle-morph), re-built
 * without three.js: a pre-baked 3D point cloud of a bust, rotated and
 * perspective-projected per frame. ~1,400 dots, zero dependencies.
 *
 *  - idle: slow ±35° head turn, a scan band sweeping down, occasional
 *    slice glitch
 *  - approve (twin-pulse "approve"): an oxblood pulse travels feet→crown
 *  - failure (twin-pulse "error"): heavy red slice-glitch flicker
 *
 * Degrades to a static SVG projection on mobile / prefers-reduced-motion.
 */

const INK = "232,232,227";
const OXBRIGHT = "166,27,28";

interface Pt {
  x: number;
  y: number;
  z: number;
}

// Deterministic PRNG so SSR and client render the identical static cloud.
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Procedural bust: skull, jaw, neck, shoulders as sampled surfaces. Model space: y down, origin mid-head. */
function buildBust(): Pt[] {
  const rnd = lcg(42);
  const pts: Pt[] = [];
  const onEllipsoid = (n: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, keep: (p: Pt) => boolean) => {
    for (let i = 0; i < n * 3 && pts.length < 4000; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(2 * rnd() - 1);
      const p = {
        x: cx + rx * Math.sin(phi) * Math.cos(theta),
        y: cy + ry * Math.cos(phi),
        z: cz + rz * Math.sin(phi) * Math.sin(theta),
      };
      if (keep(p)) {
        pts.push(p);
        if (--n <= 0) return;
      }
    }
  };
  onEllipsoid(650, 0, -12, 0, 23, 29, 25, () => true); // skull
  onEllipsoid(220, 0, 8, 5, 15, 15, 15, (p) => p.y > 6); // jaw/chin
  // neck: cylinder
  for (let i = 0; i < 130; i++) {
    const a = rnd() * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 9, y: 22 + rnd() * 16, z: Math.sin(a) * 9 });
  }
  onEllipsoid(320, 0, 50, 0, 38, 13, 15, (p) => p.y < 50); // shoulders
  return pts;
}

const BUST = buildBust();
const MODEL_TOP = -42;
const MODEL_BOTTOM = 52;

function project(p: Pt, angle: number, scale: number, cx: number, cy: number) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const x = p.x * cosA - p.z * sinA;
  const z = p.x * sinA + p.z * cosA;
  const f = 130 / (130 + z); // perspective
  return { px: cx + x * f * scale, py: cy + p.y * f * scale, depth: (z + 40) / 80 };
}

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

    const scale = size / 115;
    const cx = size / 2;
    const cy = size / 2 - 4;

    let approveStart = -1;
    let errorUntil = -1;
    let glitchAt = performance.now() + 3000;
    let glitchY = 0;
    let raf = 0;

    const onPulse = (e: Event) => {
      const kind = (e as CustomEvent).detail;
      const t = performance.now();
      if (kind === "approve") approveStart = t;
      else if (kind === "error") errorUntil = t + 750;
    };
    window.addEventListener("twin-pulse", onPulse);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, size, size);

      const angle = 0.62 * Math.sin(t * 0.00028); // slow ±35° head turn
      // Scan band sweeping top → bottom on a 2.8s cycle (model-space y)
      const scanY = MODEL_TOP + ((t % 2800) / 2800) * (MODEL_BOTTOM - MODEL_TOP);
      // Idle slice glitch every 3–7s for 160ms
      const inGlitch = t > glitchAt && t < glitchAt + 160;
      if (t > glitchAt + 160) {
        glitchAt = t + 3000 + Math.random() * 4000;
        glitchY = MODEL_TOP + Math.random() * (MODEL_BOTTOM - MODEL_TOP);
      }
      const hardError = t < errorUntil;
      // Approve pulse: a band travelling bottom → top over 650ms
      const approveP = approveStart >= 0 ? (t - approveStart) / 650 : -1;
      if (approveP > 1.15) approveStart = -1;
      const approveY = approveP >= 0 ? MODEL_BOTTOM - approveP * (MODEL_BOTTOM - MODEL_TOP) : -999;

      for (const p of BUST) {
        const { px, py, depth } = project(p, angle, scale, cx, cy);
        let x = px;
        let rgb = INK;
        let alpha = 0.10 + depth * 0.42;
        let r = 0.5 + depth * 0.65;

        // scan shimmer
        if (Math.abs(p.y - scanY) < 3.5) {
          alpha = Math.min(1, alpha + 0.35);
          r += 0.2;
        }
        // idle glitch slice: shear a horizontal band, tint oxblood
        if ((inGlitch || hardError) && Math.abs(p.y - (hardError ? ((t / 60) % 90) - 45 : glitchY)) < (hardError ? 14 : 5)) {
          x += hardError ? (Math.random() - 0.5) * 6 : 3;
          rgb = OXBRIGHT;
          alpha = Math.min(1, alpha + 0.4);
        }
        if (hardError && Math.random() < 0.08) rgb = OXBRIGHT;
        // approve pulse band
        if (Math.abs(p.y - approveY) < 6) {
          rgb = OXBRIGHT;
          alpha = Math.min(1, alpha + 0.55);
          r += 0.4;
        }

        ctx.fillStyle = `rgba(${rgb},${alpha})`;
        ctx.fillRect(x - r / 2, py - r / 2, r, r);
      }

      // hologram base: faint emitter line + glow under the bust
      const baseY = cy + MODEL_BOTTOM * scale + 2;
      const grad = ctx.createLinearGradient(cx - 26, baseY, cx + 26, baseY);
      grad.addColorStop(0, `rgba(${OXBRIGHT},0)`);
      grad.addColorStop(0.5, `rgba(${OXBRIGHT},${hardError ? 0.9 : 0.45})`);
      grad.addColorStop(1, `rgba(${OXBRIGHT},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(cx - 26, baseY, 52, 1);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("twin-pulse", onPulse);
    };
  }, [staticMode, size]);

  if (staticMode) {
    // Static front projection of the same cloud — deterministic, zero cost.
    const scale = 88 / 115;
    const dots = BUST.filter((_, i) => i % 2 === 0).map((p) => project(p, 0.3, scale, 44, 40));
    return (
      <svg width={size} height={size} viewBox="0 0 88 88" aria-hidden className="shrink-0">
        {dots.map((d, i) => (
          <circle key={i} cx={d.px} cy={d.py} r={0.35 + d.depth * 0.45} fill="#E8E8E3" opacity={0.1 + d.depth * 0.4} />
        ))}
        <rect x="20" y="83" width="48" height="1" fill="#A61B1C" opacity="0.4" />
      </svg>
    );
  }

  return <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden className="shrink-0" />;
}
