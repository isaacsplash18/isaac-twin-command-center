"use client";

import { useEffect, useRef, useState } from "react";

/**
 * NOVA — the twin's face, built from the Halo-4 Cortana reference frame
 * (public/nova-face.png) via image-based holography:
 *
 *   Each sampled pixel becomes a glowing point; its LUMINANCE sets both its
 *   brightness and its DEPTH (bright = closer). The result is a genuine 3D
 *   relief of the reference that parallaxes as she turns to follow your
 *   cursor. Her eyes are the brightest pixels, so they read as embers
 *   automatically. Scan-line shimmer, hologram slice glitches, an approve
 *   pulse (crown→base flash) and a failure glitch complete the effect.
 *
 *   Palette: ink dots with oxblood highlights (the app's scarcity accent).
 *   If the reference image fails to load, Nova falls back to the
 *   parametric contour-ring bust. Plain canvas 2D, no dependencies.
 */

const INK = "232,232,227";
const OXBRIGHT = "166,27,28";

export type NovaMood = "praise" | "sass" | "neutral";

interface Pt {
  x: number;
  y: number;
  z: number;
  /** brightness 0..1 (image mode: pixel luminance) */
  b: number;
  kind: "img" | "imgeye" | "shell" | "pupil";
  nx?: number;
  nz?: number;
}

// ---------------------------------------------------------------------------
// Image-based cloud: luminance → depth relief
// ---------------------------------------------------------------------------

const MODEL_TOP = -40;
const MODEL_BOTTOM = 44;

function sampleImage(img: HTMLImageElement, step: number): Pt[] {
  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const octx = off.getContext("2d");
  if (!octx) return [];
  octx.drawImage(img, 0, 0);
  const { data } = octx.getImageData(0, 0, off.width, off.height);

  const pts: Pt[] = [];
  for (let py = 0; py < off.height; py += step) {
    for (let px = 0; px < off.width; px += step) {
      const i = (py * off.width + px) * 4;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      if (lum < 0.11) continue;
      const u = px / off.width;
      const v = py / off.height;
      // soft elliptical mask kills the background bokeh
      const e = Math.hypot((u - 0.5) / 0.46, (v - 0.52) / 0.52);
      if (e > 1.05) continue;
      const fade = e > 0.82 ? Math.max(0, 1 - (e - 0.82) / 0.23) : 1;
      if (fade <= 0.05) continue;
      pts.push({
        x: (u - 0.5) * 62,
        y: (v - 0.5) * 82 + 2,
        // bright pixels sit forward; masked edges recede
        z: 12 - lum * 30 + Math.max(0, e - 0.7) * 26,
        b: lum * fade,
        kind: lum > 0.86 ? "imgeye" : "img",
      });
    }
  }
  return pts;
}

function loadImageCloud(step: number): Promise<Pt[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const pts = sampleImage(img, step);
      pts.length > 500 ? resolve(pts) : reject(new Error("sample too sparse"));
    };
    img.onerror = () => reject(new Error("nova-face.png failed to load"));
    img.src = "/nova-face.png";
  });
}

// ---------------------------------------------------------------------------
// Fallback: parametric contour-ring bust (no image required)
// ---------------------------------------------------------------------------

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const gauss = (v: number, mu: number, sigma: number) => Math.exp(-((v - mu) ** 2) / (2 * sigma * sigma));

function buildFallbackBust(): Pt[] {
  const rnd = lcg(7);
  const pts: Pt[] = [];
  const profile = (y: number): { rx: number; rz: number } | null => {
    if (y < -35 || y > 44) return null;
    let r: number;
    if (y <= -12) {
      const t = (y + 12) / 23.5;
      r = 22 * Math.sqrt(Math.max(0, 1 - t * t));
    } else if (y <= 19) {
      const t = (y + 12) / 31;
      r = 22 * (1 - 0.58 * Math.pow(t, 1.6));
    } else r = 9.2;
    if (y > 14 && y <= 34) {
      const t = Math.min(1, (y - 14) / 7);
      r = r * (1 - t) + 8.8 * t;
    } else if (y > 34) {
      const t = (y - 34) / 19;
      return { rx: 9 + Math.pow(t, 1.35) * 33, rz: 11 + t * 3 };
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
  for (let y = -35; y <= 44; y += 1.55) {
    const base = profile(y);
    if (!base || base.rx < 0.8) continue;
    const steps = Math.max(10, Math.floor((Math.PI * (base.rx + base.rz)) / 2.1));
    for (let i = 0; i < steps; i++) {
      const theta = (i / steps) * Math.PI * 2 - Math.PI + rnd() * 0.06;
      const d = y < 20 ? relief(theta, y) : 0;
      const rx = base.rx + d;
      const rz = base.rz + d;
      const x = Math.sin(theta) * rx;
      const z = Math.cos(theta) * rz;
      const nl = Math.hypot(x / (rx * rx), z / (rz * rz)) || 1;
      pts.push({ x, y: y + (rnd() - 0.5) * 0.5, z, b: 1, kind: "shell", nx: x / (rx * rx) / nl, nz: z / (rz * rz) / nl });
    }
  }
  for (const side of [-1, 1]) {
    const theta = side * 0.36;
    pts.push({ x: Math.sin(theta) * 19.5, y: -13.5, z: Math.cos(theta) * 21.5, b: 3, kind: "pupil", nx: 0, nz: 1 });
  }
  return pts;
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
    let cloud: Pt[] = [];
    let imageMode = false;
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
      // image relief breaks past ~±14°, so the cap is tighter in image mode
      const yawCap = imageMode ? 0.24 : 0.85;
      const pitchCap = imageMode ? 0.12 : 0.4;
      targetYaw = Math.max(-yawCap, Math.min(yawCap, nx * yawCap * 1.1));
      targetPitch = Math.max(-pitchCap, Math.min(pitchCap, ny * pitchCap * 1.1));
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

      const idleYaw = (imageMode ? 0.1 : 0.3) * Math.sin(t * 0.00022);
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
      // Mood is glow behavior in image mode: praise burns brighter,
      // sass flickers like a projector losing patience.
      const moodGlow =
        mood === "praise" ? 1.18 : mood === "sass" ? 0.88 + 0.06 * Math.sin(t * 0.011) : 1;

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

        let rgb: string;
        let alpha: number;
        let r: number;
        if (p.kind === "img" || p.kind === "imgeye") {
          rgb = p.kind === "imgeye" ? OXBRIGHT : INK;
          alpha = Math.min(1, (0.05 + Math.pow(p.b, 0.8) * 0.85) * moodGlow);
          r = (0.5 + p.b * 1.15) * (scale / 3.6);
        } else {
          const nz2 = (p.nx ?? 0) * sinY + (p.nz ?? 0) * cosY;
          const facing = Math.max(0, -nz2);
          const depth = Math.max(0, Math.min(1, (45 - z2) / 90));
          rgb = p.kind === "pupil" ? OXBRIGHT : INK;
          alpha = p.kind === "pupil" ? 0.95 : (0.05 + depth * 0.22 + facing * 0.33) * moodGlow;
          r = (0.55 + depth * 0.55 + facing * 0.35) * (p.kind === "pupil" ? 1.9 : 1) * (scale / 3.4);
        }

        if (Math.abs(p.y - scanY) < 3) alpha = Math.min(1, alpha + 0.28);
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

    const start = () => {
      if (cancelled) return;
      draw(performance.now());
      if (!reduced) {
        const loop = (t: number) => {
          draw(t);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }
    };

    loadImageCloud(coarse ? 3 : 2)
      .then((pts) => {
        imageMode = true;
        cloud = pts;
        start();
      })
      .catch((err) => {
        console.warn("Nova: image cloud unavailable, using parametric bust —", err);
        cloud = buildFallbackBust();
        start();
      });

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
