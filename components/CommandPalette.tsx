"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Signature element #3 (PRD §5.3): ⌘K / Ctrl-K on desktop, long-press
 * anywhere on mobile. Approve/reject by keyboard, jump to platform,
 * publish next slot, search drafts.
 */
export function CommandPalette({ actions }: { actions: PaletteAction[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘K / Ctrl-K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Long-press (600ms) on mobile, ignoring presses that start on buttons/inputs/links
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea")) return;
      timer = setTimeout(() => setOpen(true), 600);
    };
    const cancel = () => timer && clearTimeout(timer);
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", cancel);
    window.addEventListener("touchmove", cancel);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", cancel);
      window.removeEventListener("touchmove", cancel);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(q));
  }, [actions, query]);

  const runAction = (a: PaletteAction | undefined) => {
    if (!a) return;
    setOpen(false);
    a.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onClick={() => setOpen(false)}
        >
          <motion.div
            className="glass relative w-full max-w-lg overflow-hidden border border-hairline shadow-2xl"
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  runAction(filtered[cursor]);
                }
              }}
              placeholder="Command or search…"
              className="w-full border-b border-hairline bg-transparent px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-dim/60 focus:outline-none"
            />
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {filtered.length === 0 && (
                <li className="px-4 py-3 font-mono text-xs text-ink-dim">No matches.</li>
              )}
              {filtered.map((a, i) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => runAction(a)}
                    className={`flex w-full items-baseline justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                      i === cursor ? "bg-ink/5 text-ink" : "text-ink-dim"
                    }`}
                  >
                    <span>{a.label}</span>
                    {a.hint && <span className="font-mono text-[10px] tracking-wider text-ink-dim/70">{a.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-hairline-faint px-4 py-2 font-mono text-[10px] tracking-wider text-ink-dim/60">
              ↑↓ NAVIGATE · ↵ RUN · ESC CLOSE
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
