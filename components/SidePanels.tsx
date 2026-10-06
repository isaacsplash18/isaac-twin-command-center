"use client";

import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";
import { LinkItem, PanelsData, formatSgt } from "./types";
import automations from "@/automations.json";

function LinkList({ items, empty }: { items: LinkItem[]; empty: string }) {
  if (items.length === 0)
    return <p className="mt-1 text-[13px] text-ink-dim/70">{empty}</p>;
  return (
    <ul className="mt-1">
      {items.map((i) => (
        <li
          key={i.id}
          className="border-b border-hairline-faint py-1.5 last:border-b-0"
        >
          <a
            href={i.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm text-ink hover:underline"
          >
            {i.title || "Untitled"}
          </a>
          {i.meta && (
            <span className="text-[13px] text-ink-dim/70">
              {formatSgt(i.meta)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PositionsPanel({
  data,
  index,
}: {
  data: PanelsData["positions"] | undefined;
  index: number;
}) {
  return (
    <FrameCard index={index} className="p-4">
      <h2 className="panel-heading">Positions</h2>
      {!data ? (
        <p className="mt-2 text-[13px] text-ink-dim">Loading…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["Confirmed", "Predicted", "Contested"] as const).map((c) => (
              <div key={c} className="border border-hairline-faint px-2 py-2">
                <div className="text-[13px] leading-snug text-ink-dim">{c}</div>
                <div
                  className={`mt-0.5 font-mono text-lg ${
                    c === "Confirmed"
                      ? "text-phosphor"
                      : c === "Contested"
                        ? "text-oxbright"
                        : "text-ink"
                  }`}
                >
                  {data.confidenceCounts[c] ?? 0}
                </div>
              </div>
            ))}
          </div>
          {data.needsValidation.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-medium text-amber">
                Needs validation
              </h3>
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
      <h2 className="panel-heading">Inputs</h2>
      <h3 className="mt-3 text-sm font-medium text-ink-dim">
        Inbox · Recent captures
      </h3>
      <LinkList items={inbox ?? []} empty="Inbox clear." />
      <h3 className="mt-3 text-sm font-medium text-ink-dim">
        Wiki · Recently touched
      </h3>
      <LinkList items={wiki ?? []} empty="No recent wiki activity." />
    </FrameCard>
  );
}

/** Degraded v1 (PRD §7.6): static config from the repo, clearly marked. */
export function AutomationsPanel({ index }: { index: number }) {
  return (
    <FrameCard index={index} className="p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="panel-heading">Automations</h2>
        <span className="text-[13px] text-amber">Config only · not live</span>
      </div>
      <ul className="mt-2">
        {automations.map((a) => (
          <li
            key={a.name}
            className="border-b border-hairline-faint py-2 last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-ink">{a.name}</span>
              <span className="text-[13px] text-ink-dim">{a.cadence}</span>
            </div>
            <p className="mt-0.5 text-[13px] text-ink-dim">{a.purpose}</p>
          </li>
        ))}
      </ul>
    </FrameCard>
  );
}
