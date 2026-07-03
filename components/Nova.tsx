"use client";

import { useEffect, useRef, useState } from "react";

/**
 * NOVA — the twin's face: TRUE 3D geometry with a projected photographic
 * face.
 *
 *   The head is a parametric bust (contour rings with facial relief), so
 *   rotation is real 3D from any angle. Onto that geometry we project the
 *   generated portrait (public/nova-portrait.png — front-facing studio
 *   portrait): each surface point samples the portrait's luminance at its
 *   front-planar projection, so her features light the correct places on
 *   the 3D form and stay attached as the head turns. The back of the head
 *   falls off to a dim structural shell. Scan-line shimmer, hologram slice
 *   glitches, approve pulse and failure glitch complete the effect.
 *
 *   Palette: ink dots with oxblood highlights (the app's scarcity accent).
 *   If the portrait fails to load, Nova renders the untextured bust.
 *   Plain canvas 2D, no dependencies.
 */

const INK = "232,232,227";
const OXBRIGHT = "166,27,28";

export type NovaMood = "praise" | "sass" | "neutral";

interface Pt {
  x: number;
  y: number;
  z: number;
  /** portrait luminance at this point (0..1), 0 when untextured */
  b: number;
  /** texture weight: how front-facing this point is in model space */
  tw: number;
  kind: "shell" | "pupil";
  nx: number;
  nz: number;
}

const MODEL_TOP = -38;
const MODEL_BOTTOM = 46;

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const gauss = (v: number, mu: number, sigma: number) => Math.exp(-((v - mu) ** 2) / (2 * sigma * sigma));

/** Parametric bust: contour rings + facial relief. Front = +z. */
function buildBust(dense: boolean): Pt[] {
  const rnd = lcg(7);
  const pts: Pt[] = [];
  const profile = (y: number): { rx: number; rz: number } | null => {
    if (y < -35 || y > 44) return null;
    let r: number;
    if (y <= -12) {
      // cranium: wider, softer dome
      const t = (y + 12) / 23.5;
      r = 23.5 * Math.sqrt(Math.max(0, 1 - t * t));
    } else if (y <= 17) {
      // face: taper to the chin
      const t = (y + 12) / 29;
      r = 23.5 * (1 - 0.6 * Math.pow(t, 1.6));
    } else r = 9;
    if (y > 12 && y <= 26) {
      // short neck
      const t = Math.min(1, (y - 12) / 6);
      r = r * (1 - t) + 8.5 * t;
    } else if (y > 26) {
      // shoulders/trapezius: wide, rising quickly
      const t = (y - 26) / 18;
      return { rx: 8.5 + Math.pow(t, 1.2) * 36, rz: 10.5 + t * 4 };
    }
    return { rx: r * 0.94, rz: r * 1.06 };
  };
  const relief = (theta: number, y: number): number => {
    const t = Math.abs(theta);
    let d = 0;
    d += 1.7 * gauss(y, -18.5, 2.4) * gauss(t, 0.32, 0.28);
    d -= 2.6 * gauss(y, -13.5, 2.4) * (gauss(theta, 0.36, 0.16) + gauss(theta, -0.36, 0.16));
    d += 6.2 * gauss(theta, 0, 0.13) * gauss(y, -2, 5.2);
    d -= 2.6 * gauss(theta, 0, 0.18) * gauss(y, 4.5, 1.6);
    d += 1.8 * gauss(theta, 0, 0.26) * (gauss(y, 8.4, 1.1) + gauss(y, 11.6, 1.2));
    d -= 1.4 * gauss(theta, 0, 0.24) * gauss(y, 10, 0.7);
    d += 1.4 * gauss(theta, 0, 0.27) * gauss(y, 16, 2.2);
    return d;
  };
  const yStep = dense ? 1.15 : 1.7;
  const arc = dense ? 1.6 : 2.3;
  for (let y = -35; y <= 44; y += yStep) {
    const base = profile(y);
    if (!base || base.rx < 0.8) continue;
    const steps = Math.max(10, Math.floor((Math.PI * (base.rx + base.rz)) / arc));
    for (let i = 0; i < steps; i++) {
      const theta = (i / steps) * Math.PI * 2 - Math.PI + rnd() * 0.05;
      const d = y < 20 ? relief(theta, y) : 0;
      const rx = base.rx + d;
      const rz = base.rz + d;
      const x = Math.sin(theta) * rx;
      const z = Math.cos(theta) * rz;
      const nl = Math.hypot(x / (rx * rx), z / (rz * rz)) || 1;
      pts.push({
        x,
        y: y + (rnd() - 0.5) * 0.4,
        z,
        b: 0,
        tw: 0,
        kind: "shell",
        nx: x / (rx * rx) / nl,
        nz: z / (rz * rz) / nl,
      });
    }
  }
  for (const side of [-1, 1]) {
    const theta = side * 0.36;
    pts.push({
      x: Math.sin(theta) * 19.5,
      y: -13.5,
      z: Math.cos(theta) * 21.5,
      b: 1,
      tw: 0,
      kind: "pupil",
      nx: 0,
      nz: 1,
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Portrait projection: front-planar mapping model space → portrait UV
// (calibrated against public/nova-portrait.png: crown v≈0.06, chin v≈0.625,
// head half-width ≈ 0.18 of image width)
// ---------------------------------------------------------------------------

function portraitUV(x: number, y: number): { u: number; v: number } {
  let v: number;
  if (y <= 17) v = 0.06 + (y + 35) * ((0.625 - 0.06) / 52);
  else v = 0.625 + (y - 17) * ((0.97 - 0.625) / 27);
  // width factor widens from head to shoulders
  const f = y <= 17 ? 0.0084 : 0.0084 + Math.min(1, (y - 17) / 14) * (0.0122 - 0.0084);
  return { u: 0.5 + x * f, v };
}

function loadPortraitSampler(): Promise<(u: number, v: number) => number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const octx = off.getContext("2d");
      if (!octx) return reject(new Error("no 2d context"));
      octx.drawImage(img, 0, 0);
      const { data } = octx.getImageData(0, 0, off.width, off.height);
      resolve((u: number, v: number) => {
        if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
        const px = Math.min(off.width - 1, Math.max(0, Math.round(u * off.width)));
        const py = Math.min(off.height - 1, Math.max(0, Math.round(v * off.height)));
        const i = (py * off.width + px) * 4;
        return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      });
    };
    img.onerror = () => reject(new Error("nova-portrait.png failed to load"));
    img.src = "/nova-portrait.png";
  });
}

/** Bake portrait luminance onto front-facing bust points (in place). */
function texturize(pts: Pt[], sample: (u: number, v: number) => number) {
  for (const p of pts) {
    if (p.kind !== "shell") continue;
    const facing = Math.max(0, p.nz); // model-space front
    if (facing < 0.08) continue;
    const { u, v } = portraitUV(p.x, p.y);
    p.b = sample(u, v);
    p.tw = Math.pow(facing, 0.7);
  }
}

// ---------------------------------------------------------------------------

export function Nova({ mood, line }: { mood: NovaMood; line: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moodRef = useRef<NovaMood>(mood);
  moodRef.current = mood;
  const [size, setSize] = useState(400);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const measure = () => {
      const vw = window.innerWidth || document.documentElement.clientWidth || 430;
      setSize(Math.max(260, Math.min(430, vw - 40)));
    };
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
    const cloud = buildBust(!coarse);
    let cancelled = false;
    let raf = 0;

    const scale = size / 108;
    const cx = size / 2;
    const cy = size / 2 - 2;

    let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0;
    let pointer: { x: number; y: number } | null = null;
    let approveStart = -1, errorUntil = -1;
    let glitchAt = performance.now() + 3500, glitchY = 0;

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      targetYaw = Math.max(-0.85, Math.min(0.85, nx * 0.9));
      targetPitch = Math.max(-0.35, Math.min(0.45, ny * 0.4));
      pointer =
        e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
          ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
          : null;
    };
    const onLeave = () => (pointer = null);
    const onTap = () => (approveStart = performance.now());
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

      const idleYaw = 0.28 * Math.sin(t * 0.00022);
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
      const moodGlow = mood === "praise" ? 1.15 : mood === "sass" ? 0.88 + 0.06 * Math.sin(t * 0.011) : 1;

      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);

      for (const p of cloud) {
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y2 = p.y * cosP - z1 * sinP;
        const z2 = p.y * sinP + z1 * cosP;

        const f = 200 / (200 + z2);
        let px = cx + x1 * f * scale;
        let py = cy + y2 * f * scale;
        const depth = Math.max(0, Math.min(1, (45 - z2) / 90));

        // camera-facing shading from the rotated surface normal
        const nz2 = p.nx * sinY + p.nz * cosY;
        const facingCam = Math.max(0, -nz2);

        let rgb = p.kind === "pupil" ? OXBRIGHT : INK;
        let alpha: number;
        let r: number;
        if (p.kind === "pupil") {
          alpha = 0.95;
          r = 1.9 * (scale / 3.4);
        } else {
          const tex = p.b * p.tw; // portrait luminance where textured
          alpha = Math.min(1, (0.035 + depth * 0.07 + facingCam * 0.1 + Math.pow(tex, 0.85) * 0.9) * moodGlow);
          r = (0.45 + depth * 0.3 + tex * 1.2) * (scale / 3.5);
        }

        if (Math.abs(p.y - scanY) < 3) alpha = Math.min(1, alpha + 0.26);
        if ((inGlitch || hardError) && Math.abs(p.y - (hardError ? ((t / 50) % 84) - 40 : glitchY)) < (hardError ? 15 : 5)) {
          px += hardError ? (Math.random() - 0.5) * 8 : 3.5;
          rgb = OXBRIGHT;
          alpha = Math.min(1, alpha + 0.45);
        }
        if (hardError && Math.random() < 0.06) rgb = OXBRIGHT;
        if (Math.abs(p.y - approveY) < 6) {
          rgb = OXBRIGHT;
          alpha = Math.min(1, alpha + 0.55);
          r *= 1.5;
        }
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
      const baseY = cy + (MODEL_BOTTOM + 5) * scale;
      const w = 46 * scale;
      const grad = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
      grad.addColorStop(0, `rgba(${OXBRIGHT},0)`);
      grad.addColorStop(0.5, `rgba(${OXBRIGHT},${hardError ? 0.9 : 0.4})`);
      grad.addColorStop(1, `rgba(${OXBRIGHT},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(cx - w, Math.min(baseY, size - 2), w * 2, 1.5);
    };

    // First frame synchronously (untextured shell), then the loop; the
    // portrait bakes in as soon as it loads — no restart needed.
    draw(performance.now());
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    if (!reduced) raf = requestAnimationFrame(loop);

    loadPortraitSampler()
      .then((sample) => {
        if (cancelled) return;
        texturize(cloud, sample);
        if (reduced) draw(performance.now());
      })
      .catch((err) => console.warn("Nova: portrait unavailable, rendering untextured bust —", err));

    return () => {
      cancelled = true;
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
