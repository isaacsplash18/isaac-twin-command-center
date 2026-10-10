"use client";

import { useReducedMotion } from "framer-motion";
import { useState } from "react";
import { Nova, NovaMood } from "./Nova";

export function NovaCompanion({
  mood,
  line,
  onTrain,
}: {
  mood: NovaMood;
  line: string;
  onTrain: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  return (
    <section className="nova-console" aria-label="Nova holographic companion">
      <div className="nova-console-header">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-cyan-200"
          />
          NOVA / COMPANION
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
        <div className="nova-projection">
          <div className="nova-orbit" aria-hidden="true" />
          <Nova mood={mood} line="" paused={paused} />
        </div>
        <div className="nova-brief">
          <h2 className="text-sm font-semibold text-white">A note from Nova</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{line}</p>
          <button className="nova-train" onClick={onTrain}>
            Train your twin <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <div className="nova-console-footer" aria-hidden="true">
        <span>ISAAC TWIN</span>
        <span>PERSONAL INTELLIGENCE</span>
      </div>
    </section>
  );
}
