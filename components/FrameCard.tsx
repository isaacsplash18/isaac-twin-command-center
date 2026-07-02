"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";

/**
 * Signature element #5 (PRD §5.3): panels and cards mount with a 250ms
 * border-trace + 150ms content fade, staggered 40ms. Exit (approve) runs a
 * swift oxblood sweep across the card. Arwes-style frame corners,
 * re-implemented — no dependency.
 */
export function FrameCard({
  children,
  index = 0,
  className = "",
  sweep = false,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  /** When true the exit animation is the oxblood approve sweep. */
  sweep?: boolean;
}) {
  const reduced = useReducedMotion();
  const delay = reduced ? 0 : Math.min(index, 12) * 0.04;
  const trace = (extra: number) =>
    reduced ? { duration: 0 } : { duration: 0.125, delay: delay + extra, ease: "easeOut" as const };

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0.001 }}
      animate={{ opacity: 1 }}
      exit={
        reduced
          ? { opacity: 0, transition: { duration: 0.1 } }
          : { opacity: 0, x: sweep ? 20 : 0, transition: { duration: 0.22, ease: "easeIn" } }
      }
      className={`relative overflow-hidden bg-panel ${className}`}
    >
      {/* Border trace: top → right, left → bottom */}
      <motion.span aria-hidden className="absolute left-0 top-0 h-px w-full origin-left bg-hairline"
        initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={trace(0)} />
      <motion.span aria-hidden className="absolute left-0 top-0 h-full w-px origin-top bg-hairline"
        initial={reduced ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={trace(0)} />
      <motion.span aria-hidden className="absolute right-0 top-0 h-full w-px origin-top bg-hairline"
        initial={reduced ? false : { scaleY: 0 }} animate={{ scaleY: 1 }} transition={trace(0.125)} />
      <motion.span aria-hidden className="absolute bottom-0 left-0 h-px w-full origin-left bg-hairline"
        initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={trace(0.125)} />
      {/* Frame corners */}
      {(["left-0 top-0 border-l border-t", "right-0 top-0 border-r border-t",
         "left-0 bottom-0 border-l border-b", "right-0 bottom-0 border-r border-b"] as const).map((pos) => (
        <motion.span
          key={pos}
          aria-hidden
          className={`absolute h-2 w-2 border-ink/40 ${pos}`}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.15, delay: delay + 0.2 }}
        />
      ))}
      {/* Oxblood approve sweep (visible during exit only) */}
      {sweep && !reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 bg-oxbright/70"
          initial={{ x: "-101%" }}
          exit={{ x: "101%", transition: { duration: 0.22, ease: "easeIn" } }}
        />
      )}
      <motion.div
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduced ? 0 : 0.15, delay: delay + (reduced ? 0 : 0.12) }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
