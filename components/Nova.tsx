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
  /** unit surface normal (for facing-the-camera shading) */
  nx: number;
  nz: number;
  /** brightness multiplier */
  b: number;
  kind: "shell" | "pupil" | "mouth";
  /** lips remember their angular offset for the mood curve */
  mx?: number;
}

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const gauss = (v: number, mu: number, sigma: number) => Math.exp(-((v - mu) ** 2) / (2 * sigma * sigma));

/**
 * Parametric bust, sampled as horizontal contour rings (3D-scanner look).
 * The face is surface relief, not decoration: the nose, lips, brow and chin
 * displace the rings outward; the eye sockets indent them. Dots are spaced
 * evenly by arc length so the cloud reads as a coherent scan, not noise.
 *
 * Model space: y down, head centred on x=0, front = +z (θ=0).
 */
function buildNova(): Pt[] {
  const rnd = lcg(7);
  const pts: Pt[] = [];

  // --- lathe profile: base radii per y ---
  const profile = (y: number): { rx: number; rz: number } | null => {
    if (y < -35 || y > 53) return null;
    let r: number;
    if (y <= -12) {
      // cranium: hemisphere-ish
      const t = (y + 12) / 23.5;
      r = 22 * Math.sqrt(Math.max(0, 1 - t * t));
    } else if (y <= 19) {
      // face: taper toward the chin
      const t = (y + 12) / 31;
      r = 22 * (1 - 0.58 * Math.pow(t, 1.6));
    } else {
      r = 9.2;
    }
    // neck: blend the jaw into a column, then flare into shoulders/trapezius
    if (y > 14 && y <= 34) {
      const t = Math.min(1, (y - 14) / 7);
      r = r * (1 - t) + 8.8 * t;
    } else if (y > 34) {
      const t = (y - 34) / 19;
      const shoulder = 9 + Math.pow(t, 1.35) * 33;
      return { rx: shoulder, rz: 11 + t * 3 };
    }
    // heads are deeper than they are wide
    return { rx: r * 0.94, rz: r * 1.06 };
  };

  // --- facial relief added to the radius at front angles (θ=0 is the nose line) ---
  const relief = (theta: number, y: number): number => {
    const t = Math.abs(theta);
    let d = 0;
    // brow ridge
    d += 1.7 * gauss(y, -18.5, 2.4) * gauss(t, 0.32, 0.28);
    // eye sockets (indent)
    d -= 2.6 * gauss(y, -13.5, 2.4) * (gauss(theta, 0.36, 0.16) + gauss(theta, -0.36, 0.16));
    // nose bridge → tip
    d += 6.2 * gauss(theta, 0, 0.13) * gauss(y, -2, 5.2);
    // under-nose cut
    d -= 2.6 * gauss(theta, 0, 0.18) * gauss(y, 4.5, 1.6);
    // lips (double ridge) + mouth line shadow
    d += 1.8 * gauss(theta, 0, 0.26) * (gauss(y, 8.4, 1.1) + gauss(y, 11.6, 1.2));
    d -= 1.4 * gauss(theta, 0, 0.24) * gauss(y, 10, 0.7);
    // chin + cheekbones
    d += 1.4 * gauss(theta, 0, 0.27) * gauss(y, 16, 2.2);
    d += 1.5 * gauss(y, -6, 3.2) * gauss(t, 0.62, 0.18);
    return d;
  };

  const isLip = (theta: number, y: number) => Math.abs(theta) < 0.42 && y > 7 && y < 13;

  // --- contour rings, arc-length-even sampling ---
  for (let y = -35; y <= 53; y += 1.55) {
    const base = profile(y);
    if (!base || base.rx < 0.8) continue;
    const circumference = Math.PI * (base.rx + base.rz);
    const steps = Math.max(10, Math.floor(circumference / 2.1));
    for (let i = 0; i < steps; i++) {
      const theta = (i / steps) * Math.PI * 2 - Math.PI + rnd() * 0.06;
      const d = y < 20 ? relief(theta, y) : 0;
      const rx = base.rx + d;
      const rz = base.rz + d;
      const jy = y + (rnd() - 0.5) * 0.5;
      const x = Math.sin(theta) * rx;
      const z = Math.cos(theta) * rz;
      // normal ≈ radial direction (good enough for shading)
      const nl = Math.hypot(x / (rx * rx), z / (rz * rz)) || 1;
      pts.push({
        x,
        y: jy,
        z,
        nx: x / (rx * rx) / nl,
        nz: z / (rz * rz) / nl,
        b: 1,
        kind: isLip(theta, y) ? "mouth" : "shell",
        mx: isLip(theta, y) ? theta / 0.42 : undefined,
      });
    }
  }

  // --- pupils: one oxblood ember deep in each socket ---
  for (const side of [-1, 1]) {
    const theta = side * 0.36;
    pts.push({
      x: Math.sin(theta) * 19.5,
      y: -13.5,
      z: Math.cos(theta) * 21.5,
      nx: 0,
      nz: 1,
      b: 3,
      kind: "pupil",
    });
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
        // mood-curved lips (mx ∈ [-1,1] across the mouth)
        let my = p.y;
        if (p.kind === "mouth" && p.mx !== undefined) my = p.y + mouthCurve * p.mx * p.mx;

        // rotate: yaw (Y) then pitch (X)
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y2 = my * cosP - z1 * sinP;
        const z2 = my * sinP + z1 * cosP;

        const f = 200 / (200 + z2);
        let px = cx + x1 * f * scale;
        let py = cy + y2 * f * scale;
        const depth = Math.max(0, Math.min(1, (45 - z2) / 90));

        // facing-the-camera shading from the rotated surface normal
        const nz2 = p.nx * sinY + p.nz * cosY;
        const facing = Math.max(0, -nz2);

        let rgb = p.kind === "pupil" ? OXBRIGHT : INK;
        let alpha = 0.05 + depth * 0.22 + facing * 0.33;
        if (p.kind === "pupil") alpha = 0.95;
        let r = (0.55 + depth * 0.55 + facing * 0.35) * (p.kind === "pupil" ? 1.9 : 1) * (scale / 3.4);

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
    };

    // First frame synchronously (no blank canvas on load), then the loop
    draw(performance.now());
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    if (!reduced) raf = requestAnimationFrame(loop);

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
