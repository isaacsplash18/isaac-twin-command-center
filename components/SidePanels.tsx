"use client";

import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";
import { LinkItem, PanelsData, formatSgt } from "./types";
import automations from "@/automations.json";

function LinkList({ items, empty }: { items: LinkItem[]; empty: string }) {
  if (items.length === 0) return <p className="mt-1 font-mono text-[10px] text-ink-dim/60">{empty}</p>;
  return (
    <ul className="mt-1">
      {items.map((i) => (
        <li key={i.id} className="border-b border-hairline-faint py-1.5 last:border-b-0">
          <a href={i.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-ink hover:underline">
            {i.title || "Untitled"}
          </a>
          {i.meta && <span className="font-mono text-[9px] text-ink-dim/70">{formatSgt(i.meta)}</span>}
        </li>
      ))}
    </ul>
  );
}

export function PositionsPanel({ data, index }: { data: PanelsData["positions"] | undefined; index: number }) {
  return (
    <FrameCard index={index} className="p-4">
      <h2 className="font-mono text-[10px] tracking-[0.2em] text-ink-dim">POSITIONS LIBRARY</h2>
      {!data ? (
        <p className="mt-2 font-mono text-xs text-ink-dim">Loading…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["Confirmed", "Predicted", "Contested"] as const).map((c) => (
              <div key={c} className="border border-hairline-faint px-3 py-2">
                <div className="font-mono text-[9px] tracking-[0.15em] text-ink-dim">{c.toUpperCase()}</div>
                <div
                  className={`mt-0.5 font-mono text-lg ${
                    c === "Confirmed" ? "text-phosphor" : c === "Contested" ? "text-oxbright" : "text-ink"
                  }`}
                >
                  {data.confidenceCounts[c] ?? 0}
                </div>
              </div>
            ))}
          </div>
          {data.needsValidation.length > 0 && (
            <>
              <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-amber">NEEDS VALIDATION</h3>
              <LinkList items={data.needsValidation} empty="" />
            </>
          )}
        </>
      )}
    </FrameCard>
  );
}

export function InputsPanel({
  inbox,
  wiki,
  index,
}: {
  inbox: LinkItem[] | undefined;
  wiki: LinkItem[] | undefined;
  index: number;
}) {
  return (
    <FrameCard index={index} className="p-4">
      <h2 className="font-mono text-[10px] tracking-[0.2em] text-ink-dim">INPUTS</h2>
      <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-ink-dim/80">INBOX — RECENT CAPTURES</h3>
      <LinkList items={inbox ?? []} empty="Inbox clear." />
      <h3 className="mt-3 font-mono text-[9px] tracking-[0.2em] text-ink-dim/80">WIKI — RECENTLY TOUCHED</h3>
      <LinkList items={wiki ?? []} empty="No recent wiki activity." />
    </FrameCard>
  );
}

/** Degraded v1 (PRD §7.6): static config from the repo, clearly marked. */
export function AutomationsPanel({ index }: { index: number }) {
  return (
    <FrameCard index={index} className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[10px] tracking-[0.2em] text-ink-dim">AUTOMATIONS</h2>
        <span className="font-mono text-[9px] tracking-wider text-amber">CONFIG, NOT LIVE</span>
      </div>
      <ul className="mt-2">
        {automations.map((a) => (
          <li key={a.name} className="border-b border-hairline-faint py-2 last:border-b-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-ink">{a.name}</span>
              <span className="font-mono text-[9px] tracking-wider text-ink-dim">{a.cadence}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-dim">{a.purpose}</p>
          </li>
        ))}
      </ul>
    </FrameCard>
  );
}
