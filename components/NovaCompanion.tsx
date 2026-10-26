"use client";

import { useReducedMotion } from "framer-motion";
import { useState } from "react";
import { ConstitutionMap } from "./ConstitutionMap";

export function NovaCompanion({
  line,
  onOpenMap,
}: {
  line: string;
  onOpenMap: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  return (
    <section className="nova-console" aria-label="Nova companion and constitution map">
      <div className="nova-console-header">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-cyan-200"
          />
          NOVA / CONSTITUTION
        </span>
        {reducedMotion ? (
          <span className="nova-pause flex items-center">Reduced motion</span>
        ) : (
          <button
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
            className="nova-pause"
          >
            {paused ? "Resume motion" : "Pause motion"}
          </button>
        )}
      </div>
      <div className="nova-console-body">
        <div className="nova-projection nova-map">
          <ConstitutionMap compact paused={paused} onOpen={onOpenMap} />
        </div>
        <div className="nova-brief">
          <h2 className="text-sm font-semibold text-white">A note from Nova</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{line}</p>
          <button className="nova-train" onClick={onOpenMap}>
            Explore the map <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <div className="nova-console-footer" aria-hidden="true">
        <span>ISAAC TWIN</span>
        <span>PERSONAL CONSTITUTION</span>
      </div>
    </section>
  );
}
