"use client";

import { useEffect, useRef, useState } from "react";

/**
 * NOVA — the twin's face. A large holographic point-cloud head, centre of
 * the page, with actual features (brow, eye sockets, irises, nose, mouth).
 *
 *  - Follows the cursor: the head turns to look at the pointer; dots near
 *    the pointer are repelled like disturbed plasma.
 *  - Mood shows on the face: the mouth curves up when she's praising,
 *    down when she's unimpressed. Pupils burn oxblood.
 *  - Reacts to pipeline events: approve = oxblood pulse crown-to-base,
 *    failure = hard slice glitch.
 *  - Speaks: a typed one-liner under the head (lines chosen by the
 *    command center from real pipeline stats).
 *
 * Plain canvas 2D, ~1,900 points, no dependencies. Static single frame
 * under prefers-reduced-motion; halved point count on touch devices.
 */

const INK = "232,232,227";
const OXBRIGHT = "166,27,28";

export type NovaMood = "praise" | "sass" | "neutral";

interface Pt {
  x: number;
  y: number;
  z: number;
  /** brightness multiplier: features are brighter than the skull shell */
  b: number;
  /** feature class for runtime effects */
  kind: "shell" | "feature" | "pupil" | "mouth";
  /** mouth points remember their x-fraction for the curve */
  mx?: number;
}

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const SOCKETS = [
  { x: -8.5, y: -16, z: 20 },
  { x: 8.5, y: -16, z: 20 },
];

function buildNova(): Pt[] {
  const rnd = lcg(7);
  const pts: Pt[] = [];
  const nearSocket = (p: { x: number; y: number; z: number }) =>
    SOCKETS.some((s) => Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) < 5.2);

  const onEllipsoid = (
    n: number,
    cx: number, cy: number, cz: number,
    rx: number, ry: number, rz: number,
    keep: (p: { x: number; y: number; z: number }) => boolean,
    b = 1, kind: Pt["kind"] = "shell"
  ) => {
    for (let i = 0; i < n * 4 && n > 0; i++) {
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      const p = {
        x: cx + rx * Math.sin(ph) * Math.cos(th),
        y: cy + ry * Math.cos(ph),
        z: cz + rz * Math.sin(ph) * Math.sin(th),
      };
      if (keep(p)) {
        pts.push({ ...p, b, kind });
        n--;
      }
    }
  };

  // Skull + jaw + neck + shoulders (sockets carved out of the skull)
  onEllipsoid(950, 0, -12, 0, 23, 29, 25, (p) => !nearSocket(p));
  onEllipsoid(300, 0, 8, 5, 15, 15, 15, (p) => p.y > 6 && !nearSocket(p));
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 9, y: 22 + rnd() * 16, z: Math.sin(a) * 9, b: 1, kind: "shell" });
  }
  onEllipsoid(400, 0, 50, 0, 38, 13, 15, (p) => p.y < 50);

  // Brows: two bright arcs above the sockets
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push({ x: side * (4 + t * 9), y: -21.5 - Math.sin(t * Math.PI) * 1.6, z: 20.5 + Math.sin(t * Math.PI) * 1.2, b: 2.1, kind: "feature" });
    }
  }
  // Socket rims + irises + pupils
  for (const s of SOCKETS) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      pts.push({ x: s.x + Math.cos(a) * 4.2, y: s.y + Math.sin(a) * 3.2, z: s.z + 0.5, b: 1.7, kind: "feature" });
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push({ x: s.x + Math.cos(a) * 1.6, y: s.y + Math.sin(a) * 1.4, z: s.z + 1.6, b: 2.2, kind: "feature" });
    }
    pts.push({ x: s.x, y: s.y, z: s.z + 2.2, b: 3, kind: "pupil" });
  }
  // Nose: bridge + tip + nostril flares
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push({ x: 0, y: -14 + t * 16, z: 23.5 + Math.sin(t * Math.PI * 0.6) * 3.5, b: 1.8, kind: "feature" });
  }
  pts.push({ x: -3, y: 3.5, z: 23.5, b: 1.8, kind: "feature" });
  pts.push({ x: 3, y: 3.5, z: 23.5, b: 1.8, kind: "feature" });
  // Mouth: 15 points, curve applied at draw time from mood
  for (let i = 0; i <= 14; i++) {
    const mx = i / 14 - 0.5; // -0.5..0.5
    pts.push({ x: mx * 15, y: 12, z: 21.5, b: 2, kind: "mouth", mx });
  }
  return pts;
}

const NOVA = buildNova();
const MODEL_TOP = -42;
const MODEL_BOTTOM = 52;

export function Nova({ mood, line }: { mood: NovaMood; line: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moodRef = useRef<NovaMood>(mood);
  moodRef.current = mood;
  const [size, setSize] = useState(400);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const measure = () => setSize(Math.min(430, window.innerWidth - 40));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const cloud = coarse ? NOVA.filter((p, i) => p.kind !== "shell" || i % 2 === 0) : NOVA;

    const scale = size / 120;
    const cx = size / 2;
    const cy = size / 2 - 6 * scale;

    let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0;
    let pointer: { x: number; y: number } | null = null;
    let approveStart = -1, errorUntil = -1;
    let glitchAt = performance.now() + 3500, glitchY = 0;
    let raf = 0;

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      // Nova looks at the cursor anywhere on the page, but caps her turn
      targetYaw = Math.max(-0.85, Math.min(0.85, nx * 0.9));
      targetPitch = Math.max(-0.35, Math.min(0.45, ny * 0.4));
      pointer =
        e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
          ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
          : null;
    };
    const onLeave = () => {
      pointer = null;
    };
    const onTap = () => {
      approveStart = performance.now(); // a tap makes her ripple
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onTap);

    const onPulse = (e: Event) => {
      const kind = (e as CustomEvent).detail;
      const t = performance.now();
      if (kind === "approve") approveStart = t;
      else if (kind === "error") errorUntil = t + 800;
    };
    window.addEventListener("twin-pulse", onPulse);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, size, size);

      // Idle drift when the cursor is quiet; otherwise ease toward it
      const idleYaw = 0.3 * Math.sin(t * 0.00022);
      yaw += ((targetYaw || idleYaw) - yaw) * 0.07;
      pitch += (targetPitch - pitch) * 0.07;

      const scanY = MODEL_TOP + ((t % 3200) / 3200) * (MODEL_BOTTOM - MODEL_TOP);
      const inGlitch = t > glitchAt && t < glitchAt + 150;
      if (t > glitchAt + 150) {
        glitchAt = t + 3500 + Math.random() * 4500;
        glitchY = MODEL_TOP + Math.random() * (MODEL_BOTTOM - MODEL_TOP);
      }
      const hardError = t < errorUntil;
      const approveP = approveStart >= 0 ? (t - approveStart) / 700 : -1;
      if (approveP > 1.2) approveStart = -1;
      const approveY = approveP >= 0 ? MODEL_BOTTOM - approveP * (MODEL_BOTTOM - MODEL_TOP) : -999;

      const mood = moodRef.current;
      const mouthCurve = mood === "praise" ? -4 : mood === "sass" ? 3 : 0;

      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

      for (const p of cloud) {
        // mood-curved mouth
        let my = p.y;
        if (p.kind === "mouth" && p.mx !== undefined) my = p.y + mouthCurve * (p.mx * 2) * (p.mx * 2);

        // rotate: yaw (Y) then pitch (X)
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y2 = my * cosP - z1 * sinP;
        const z2 = my * sinP + z1 * cosP;

        const f = 200 / (200 + z2);
        let px = cx + x1 * f * scale;
        let py = cy + y2 * f * scale;
        const depth = Math.max(0, Math.min(1, (z2 + 45) / 90));

        let rgb = p.kind === "pupil" ? OXBRIGHT : INK;
        let alpha = (0.08 + depth * 0.4) * Math.min(p.b, 1.6);
        if (p.b > 1.5) alpha = Math.min(1, 0.25 + depth * 0.6);
        let r = (0.6 + depth * 0.9) * (p.b > 1.5 ? 1.25 : 1) * (scale / 3.3);

        // scan shimmer
        if (Math.abs(p.y - scanY) < 3) alpha = Math.min(1, alpha + 0.3);
        // slice glitches
        if ((inGlitch || hardError) && Math.abs(p.y - (hardError ? ((t / 50) % 90) - 45 : glitchY)) < (hardError ? 15 : 5)) {
          px += hardError ? (Math.random() - 0.5) * 8 : 3.5;
          rgb = OXBRIGHT;
          alpha = Math.min(1, alpha + 0.45);
        }
        if (hardError && Math.random() < 0.06) rgb = OXBRIGHT;
        // approve pulse
        if (Math.abs(p.y - approveY) < 6) {
          rgb = OXBRIGHT;
          alpha = Math.min(1, alpha + 0.55);
          r *= 1.5;
        }
        // cursor repulsion — disturbed plasma
        if (pointer) {
          const dx = px - pointer.x;
          const dy = py - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 46 && d > 0.01) {
            const push = ((46 - d) / 46) * 14;
            px += (dx / d) * push;
            py += (dy / d) * push;
            alpha = Math.min(1, alpha + ((46 - d) / 46) * 0.35);
          }
        }

        ctx.fillStyle = `rgba(${rgb},${alpha})`;
        ctx.fillRect(px - r / 2, py - r / 2, r, r);
      }

      // projector base
      const baseY = cy + (MODEL_BOTTOM + 4) * scale * (200 / (200 + 0));
      const w = 46 * scale;
      const grad = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
      grad.addColorStop(0, `rgba(${OXBRIGHT},0)`);
      grad.addColorStop(0.5, `rgba(${OXBRIGHT},${hardError ? 0.9 : 0.4})`);
      grad.addColorStop(1, `rgba(${OXBRIGHT},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(cx - w, Math.min(baseY, size - 2), w * 2, 1.5);

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("twin-pulse", onPulse);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onTap);
    };
  }, [size, reduced]);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, touchAction: "pan-y" }}
        aria-label="Nova — the twin's holographic face"
      />
      <NovaLine line={line} />
    </div>
  );
}

/** Typed speech line, mono, with a blinking cursor. */
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

  return (
    <p className="mt-1 max-w-xl px-4 text-center font-mono text-[11px] leading-relaxed tracking-wider text-ink-dim">
      <span className="text-oxbright">NOVA //</span> {typed}
      <span className="animate-pulse text-oxbright">▍</span>
    </p>
  );
}
