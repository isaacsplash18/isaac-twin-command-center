"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ReactNode } from "react";

/** Quiet, solid reading surfaces. Glass is reserved for navigation. */
export function FrameCard({
  children,
  className = "",
  sweep = false,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  sweep?: boolean;
  glass?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={false}
      exit={{
        opacity: 0,
        x: reduced || !sweep ? 0 : 8,
        transition: { duration: 0.12 },
      }}
      className={`rounded-2xl border border-hairline-faint bg-white shadow-[0_2px_12px_rgba(25,26,28,0.025)] ${className}`}
    >
      {children}
    </motion.div>
  );
}
