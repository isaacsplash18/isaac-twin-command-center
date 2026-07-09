"use client";

import { useEffect, useState } from "react";
import { LiquidMetal } from "@paper-design/shaders-react";

/**
 * The one WebGL liquid-metal moment (liquid-glass plan §3.5): a small
 * oxblood-tinted chrome mark. Raw WebGL2 via @paper-design/shaders-react
 * (Apache-2.0, no three.js) — mounted only via next/dynamic(ssr:false) at
 * the two call sites (CommandCenter header, BootSequence), so this module
 * and its shader chunk never land in the main bundle or SSR output.
 *
 * prefers-reduced-motion: render a single static frame (speed=0) instead of
 * animating — cheaper than tearing the canvas down and it keeps the mark
 * visually present rather than blank.
 */
export default function LiquidSigil({ size = 32 }: { size?: number }) {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <LiquidMetal
      style={{ width: size, height: size }}
      colorBack="#00000000" /* transparent — sits over glass/ground */
      colorTint="#A61B1C" /* oxbright — the scarcity accent, used once, on purpose */
      shape="diamond"
      speed={reduced ? 0 : 0.6}
      softness={0.2}
      repetition={2}
      distortion={0.08}
      contour={0.5}
    />
  );
}
