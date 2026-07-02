"use client";

import { useEffect, useState } from "react";

/**
 * Signature element #4 (PRD §5.3): one-line mono strip cycling real pipeline
 * events. No autoscroll under prefers-reduced-motion (item just swaps).
 */
export function Ticker({ lines }: { lines: string[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (lines.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % lines.length), 6000);
    return () => clearInterval(id);
  }, [lines.length]);

  if (lines.length === 0) return null;
  const line = lines[idx % lines.length];

  return (
    <div className="border-b border-hairline-faint bg-panel/60 px-4 py-1.5 sm:px-6">
      <p key={line} className="ticker-item truncate font-mono text-[11px] tracking-wide text-ink-dim">
        {line}
      </p>
    </div>
  );
}
