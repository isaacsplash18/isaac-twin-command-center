"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Signature element #2 (PRD §5.3): the app's "face" — a dot-matrix robot
 * face on a 2D canvas, behavior model lifted from the Cozmo/Vector
 * "RoboEyes" pattern (FluxGarage/RoboEyes, playfultechnology/esp32-eyes),
 * re-implemented dependency-free:
 *
 *  - idle: procedural blinks every 2.5–6s, occasional gaze saccades,
 *    slowly rotating dot halo
 *  - approve (twin-pulse "approve"): eyes squash into happy arcs +
 *    an oxblood sweep travels across the matrix
 *  - failure (twin-pulse "error"): eyes flash red, jitter, flat lids
 *
 * Degrades to a static SVG face on mobile / prefers-reduced-motion.
 */

// Face layout on a 16x12 cell grid
const COLS = 16;
const ROWS = 12;
const EYE_W = 4;
const EYE_H = 5;
const LEFT_EYE_X = 2;
const RIGHT_EYE_X = 10;
const EYE_Y = 3;

const INK = "232,232,227";
const OXBRIGHT = "166,27,28";

interface FaceState {
  openness: number; // 1 open … 0 shut
  gazeX: number; // cell offset -1..1
  gazeY: number;
  mood: "neutral" | "happy" | "error";
  nextBlinkAt: number;
  blinkPhase: number; // 0 none, else timestamp blink started
  nextSaccadeAt: number;
  moodUntil: number;
  sweepStart: number; // approve sweep start ts, -1 = off
}

/** Which cells of one eye are lit, given the current state. */
function eyeCell(row: number, col: number, s: FaceState): boolean {
  // Blink: keep the middle rows as openness drops
  const visibleRows = Math.max(1, Math.round(EYE_H * s.openness));
  const top = Math.floor((EYE_H - visibleRows) / 2);
  if (row < top || row >= top + visibleRows) return false;

  if (s.mood === "happy") {
    // Happy arc (∩): top rows full, lower rows only the outer columns
    if (row >= 3) return false;
    if (row === 2) return col === 0 || col === EYE_W - 1;
    return true;
  }
  if (s.mood === "error") {
    // Flat angry lids: drop the top row
    return row > 0;
  }
  return true;
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

    const cell = size / (COLS + 2);
    const originX = cell * 1.5;
    const originY = cell * 2;
    const dotR = cell * 0.32;

    const now = performance.now();
    const s: FaceState = {
      openness: 1,
      gazeX: 0,
      gazeY: 0,
      mood: "neutral",
      nextBlinkAt: now + 1500,
      blinkPhase: 0,
      nextSaccadeAt: now + 2200,
      moodUntil: 0,
      sweepStart: -1,
    };
    let jitterUntil = 0;
    let raf = 0;

    const onPulse = (e: Event) => {
      const kind = (e as CustomEvent).detail;
      const t = performance.now();
      if (kind === "approve") {
        s.mood = "happy";
        s.moodUntil = t + 1100;
        s.sweepStart = t;
      } else if (kind === "error") {
        s.mood = "error";
        s.moodUntil = t + 900;
        jitterUntil = t + 500;
      }
    };
    window.addEventListener("twin-pulse", onPulse);

    const dot = (cx: number, cy: number, rgb: string, alpha: number, r = dotR) => {
      ctx.fillStyle = `rgba(${rgb},${alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const draw = (t: number) => {
      // --- behavior model (RoboEyes-style) ---
      if (s.mood !== "neutral" && t > s.moodUntil) s.mood = "neutral";
      if (s.mood === "neutral") {
        if (!s.blinkPhase && t >= s.nextBlinkAt) s.blinkPhase = t;
        if (s.blinkPhase) {
          const p = (t - s.blinkPhase) / 140; // 140ms blink
          s.openness = p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
          if (p >= 1) {
            s.blinkPhase = 0;
            s.openness = 1;
            s.nextBlinkAt = t + 2500 + Math.random() * 3500;
          }
        }
        if (t >= s.nextSaccadeAt) {
          s.gazeX = Math.round(Math.random() * 2 - 1);
          s.gazeY = Math.random() < 0.3 ? 1 : 0;
          s.nextSaccadeAt = t + 1200 + Math.random() * 3000;
        }
      } else {
        s.openness = 1;
        s.gazeX = 0;
        s.gazeY = 0;
      }

      const jx = t < jitterUntil ? (Math.random() - 0.5) * 2 : 0;
      const jy = t < jitterUntil ? (Math.random() - 0.5) * 2 : 0;
      const rgb = s.mood === "error" ? OXBRIGHT : INK;

      ctx.clearRect(0, 0, size, size);

      // --- halo: slowly rotating ring of faint dots ---
      const cx0 = size / 2;
      const cy0 = size / 2;
      const haloR = size / 2 - dotR * 2;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2 + t * 0.00012;
        dot(cx0 + Math.cos(a) * haloR, cy0 + Math.sin(a) * haloR, INK, 0.1 + 0.08 * Math.sin(a * 3 + t * 0.001), dotR * 0.6);
      }

      // --- approve sweep: an oxblood column travelling left → right ---
      const sweepCol = s.sweepStart >= 0 ? ((t - s.sweepStart) / 550) * (COLS + 4) - 2 : -99;
      if (s.sweepStart >= 0 && t - s.sweepStart > 700) s.sweepStart = -1;

      // --- eyes ---
      for (const eyeX of [LEFT_EYE_X, RIGHT_EYE_X]) {
        for (let r = 0; r < EYE_H; r++) {
          for (let c = 0; c < EYE_W; c++) {
            if (!eyeCell(r, c, s)) continue;
            const gc = eyeX + c + s.gazeX;
            const gr = EYE_Y + r + s.gazeY;
            const px = originX + gc * cell + jx;
            const py = originY + gr * cell + jy;
            const nearSweep = Math.abs(gc - sweepCol) < 1.2;
            dot(px, py, nearSweep ? OXBRIGHT : rgb, nearSweep ? 0.95 : 0.85);
          }
        }
      }

      // --- mouth: single quiet dot row, widens into a smile on happy ---
      const mouthRow = EYE_Y + EYE_H + 2;
      const mouthCols =
        s.mood === "happy" ? [5, 6, 7, 8, 9, 10] : s.mood === "error" ? [6, 7, 8, 9] : [7, 8];
      for (const c of mouthCols) {
        const lift = s.mood === "happy" && (c === 5 || c === 10) ? -1 : 0;
        const px = originX + c * cell + jx;
        const py = originY + (mouthRow + lift) * cell + jy;
        const nearSweep = Math.abs(c - sweepCol) < 1.2;
        dot(px, py, nearSweep ? OXBRIGHT : rgb, nearSweep ? 0.95 : 0.5);
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
    // Static dot-matrix face — same layout, zero cost.
    const cell = 88 / (COLS + 2);
    const ox = cell * 1.5;
    const oy = cell * 2;
    const eyes: { x: number; y: number }[] = [];
    for (const eyeX of [LEFT_EYE_X, RIGHT_EYE_X])
      for (let r = 0; r < EYE_H; r++)
        for (let c = 0; c < EYE_W; c++) eyes.push({ x: ox + (eyeX + c) * cell, y: oy + (EYE_Y + r) * cell });
    return (
      <svg width={size} height={size} viewBox="0 0 88 88" aria-hidden className="shrink-0">
        {Array.from({ length: 28 }, (_, i) => {
          const a = (i / 28) * Math.PI * 2;
          return (
            <circle key={`h${i}`} cx={44 + Math.cos(a) * 40} cy={44 + Math.sin(a) * 40} r={cell * 0.2} fill="#E8E8E3" opacity="0.14" />
          );
        })}
        {eyes.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={cell * 0.32} fill="#E8E8E3" opacity="0.85" />
        ))}
        {[7, 8].map((c) => (
          <circle key={`m${c}`} cx={ox + c * cell} cy={oy + (EYE_Y + EYE_H + 2) * cell} r={cell * 0.32} fill="#E8E8E3" opacity="0.5" />
        ))}
      </svg>
    );
  }

  return <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden className="shrink-0" />;
}
