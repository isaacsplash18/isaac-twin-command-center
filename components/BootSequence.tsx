"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

const BOOT_KEY = "twin-booted";
const BOOT_LINE = "ISAAC TWIN // COMMAND CENTER — systems nominal";

/**
 * Signature element #1 (PRD §5.3): first load per session only, ≤1.2s,
 * skippable by any tap, never replays on navigation, killed entirely by
 * prefers-reduced-motion.
 */
export function BootSequence() {
  const [show, setShow] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || sessionStorage.getItem(BOOT_KEY)) return;
    sessionStorage.setItem(BOOT_KEY, "1");
    setShow(true);
    let i = 0;
    const type = setInterval(() => {
      i += 3;
      setTyped(BOOT_LINE.slice(0, i));
      if (i >= BOOT_LINE.length) clearInterval(type);
    }, 24);
    const done = setTimeout(() => setShow(false), 1200);
    return () => {
      clearInterval(type);
      clearTimeout(done);
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          type="button"
          aria-label="Skip boot sequence"
          className="fixed inset-0 z-[100] flex cursor-default items-center justify-center bg-ground"
          onClick={() => setShow(false)}
          onTouchStart={() => setShow(false)}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          <div className="w-full max-w-md px-6">
            <motion.div
              className="h-px w-full origin-left bg-oxbright/70"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
            <p className="mt-3 min-h-[1.25rem] text-left font-mono text-xs tracking-[0.2em] text-ink">
              {typed}
              <span className="animate-pulse text-oxbright">▍</span>
            </p>
            <motion.div
              className="mt-3 h-px w-full origin-right bg-hairline"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
            />
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
