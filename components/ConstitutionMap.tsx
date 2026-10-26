"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapSceneControls } from "./ConstitutionMapScene";
import {
  CAPTURE_COLOR,
  CONFIDENCE_COLORS,
  CORPUS_COLORS,
  DOMAIN_COLOR,
  KIND_LABELS,
  mapNodeColor,
} from "./mapPalette";
import { useApi } from "./useApi";
import type { MapData, MapNode } from "./types";

// three.js, the force engine and sprite text only load when a map mounts.
const ConstitutionMapScene = dynamic(() => import("./ConstitutionMapScene"), {
  ssr: false,
  loading: () => <MapStatus text="Charting…" />,
});

function MapStatus({ text }: { text: string }) {
  return (
    <p
      role="status"
      className="absolute inset-0 flex items-center justify-center font-mono text-[11px] uppercase tracking-[0.12em] text-[#accbd2] motion-safe:animate-pulse"
    >
      {text}
    </p>
  );
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) =>
        s.width === Math.floor(width) && s.height === Math.floor(height)
          ? s
          : { width: Math.floor(width), height: Math.floor(height) },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const mapButton =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/15 bg-[#101215]/70 px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[#e8e8e3] backdrop-blur-sm transition-colors hover:bg-white/10 aria-pressed:border-white/30 aria-pressed:bg-white/15";

function Legend({ showSources, light = false, className = "" }: { showSources: boolean; light?: boolean; className?: string }) {
  const item = (color: string, label: string) => (
    <li key={label} className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${light ? "ring-1 ring-ink/25" : ""}`}
        style={{ background: color, boxShadow: light ? undefined : `0 0 6px ${color}` }}
      />
      {label}
    </li>
  );
  return (
    <div className={`font-mono text-[11px] leading-relaxed ${className}`}>
      <p className="mb-1 uppercase tracking-[0.1em] opacity-70">Positions</p>
      <ul className="mb-2 grid grid-cols-2 gap-x-4 sm:grid-cols-1">
        {item(DOMAIN_COLOR, "Domain hub")}
        {Object.entries(CONFIDENCE_COLORS).map(([k, c]) => item(c, k))}
      </ul>
      {showSources && (
        <>
          <p className="mb-1 uppercase tracking-[0.1em] opacity-70">Sources</p>
          <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-1">
            {Object.entries(CORPUS_COLORS).map(([k, c]) => item(c, k))}
            {item(CAPTURE_COLOR, "Inbox capture")}
          </ul>
        </>
      )}
    </div>
  );
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function DetailPanel({
  node,
  data,
  onClose,
  onJump,
}: {
  node: MapNode;
  data: MapData;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const members = useMemo(() => {
    if (node.kind !== "domain") return [];
    const ids = new Set(data.links.filter((l) => l.target === node.id).map((l) => l.source));
    return data.nodes.filter((n) => ids.has(n.id));
  }, [node, data]);
  const evidence = useMemo(() => {
    if (node.kind !== "position" && node.kind !== "corpus") return [];
    const ids = new Set(
      data.links
        .filter((l) => l.kind === "evidence" && (l.source === node.id || l.target === node.id))
        .map((l) => (l.source === node.id ? l.target : l.source)),
    );
    return data.nodes.filter((n) => ids.has(n.id));
  }, [node, data]);

  const chips: { label: string; color?: string }[] = [];
  if (node.kind === "position") {
    if (node.confidence) chips.push({ label: node.confidence, color: mapNodeColor(node) });
    if (node.status) chips.push({ label: node.status });
    const validated = formatDate(node.lastValidated);
    if (validated) chips.push({ label: `Validated ${validated}` });
  } else if (node.kind === "corpus") {
    if (node.nodeType) chips.push({ label: node.nodeType, color: mapNodeColor(node) });
    if (node.maturity) chips.push({ label: node.maturity });
    if (node.recurrence) chips.push({ label: `Recurs ×${node.recurrence}` });
  } else if (node.kind === "capture") {
    if (node.type) chips.push({ label: node.type });
    if (node.status) chips.push({ label: node.status });
  } else {
    chips.push({ label: `${members.length} linked node${members.length === 1 ? "" : "s"}` });
  }

  const sections: [string, string | undefined][] =
    node.kind === "position"
      ? [
          ["Nuance", node.nuance],
          ["Basis", node.basis],
          ["Open question", node.question],
        ]
      : node.kind === "corpus"
        ? [["Summary", node.summary]]
        : node.kind === "capture"
          ? [["Triage note", node.note]]
          : [];

  const jumpList = (title: string, items: MapNode[]) =>
    items.length > 0 && (
      <div className="mt-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-dim">{title}</h3>
        <ul className="mt-1">
          {items.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => onJump(m.id)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-panel"
              >
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: mapNodeColor(m) === DOMAIN_COLOR ? "#191a1c" : mapNodeColor(m) }} />
                <span className="line-clamp-2">{m.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <motion.aside
      key={node.id}
      aria-label={`${KIND_LABELS[node.kind]} details`}
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 12, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="absolute inset-x-3 bottom-3 z-20 max-h-[62%] overflow-y-auto rounded-xl border border-hairline bg-white p-5 text-ink shadow-xl sm:inset-x-auto sm:bottom-3 sm:right-3 sm:top-[68px] sm:max-h-none sm:w-[360px]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="pt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-oxblood">{KIND_LABELS[node.kind]}</p>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="-mr-3 -mt-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-ink-dim hover:bg-panel"
        >
          ×
        </button>
      </div>
      <h2 className="mt-1 text-lg font-semibold leading-snug">{node.label}</h2>
      {chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <li
              key={c.label}
              className="flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 font-mono text-[11px]"
            >
              {c.color && (
                <span aria-hidden="true" className="h-2 w-2 rounded-full ring-1 ring-ink/15" style={{ background: c.color }} />
              )}
              {c.label}
            </li>
          ))}
        </ul>
      )}
      {node.domains && node.domains.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {node.domains.map((d) => (
            <button
              key={d}
              onClick={() => onJump(`domain:${d}`)}
              className="min-h-[32px] rounded-md bg-panel px-2 text-xs text-ink-dim hover:text-ink"
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {sections
        .filter(([, text]) => text)
        .map(([title, text]) => (
          <div key={title} className="mt-4">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-dim">{title}</h3>
            <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{text}</p>
          </div>
        ))}
      {jumpList(node.kind === "position" ? "Supporting sources" : "Linked positions", evidence)}
      {jumpList("In this domain", members)}
      <div className="mt-5 flex flex-wrap gap-2">
        {node.url && (
          <a className="btn btn-secondary" href={node.url} target="_blank" rel="noreferrer">
            Open in Notion ↗
          </a>
        )}
        {node.sourceUrl && (
          <a className="btn btn-quiet" href={node.sourceUrl} target="_blank" rel="noreferrer">
            Original source ↗
          </a>
        )}
      </div>
    </motion.aside>
  );
}

/**
 * The Personal Constitution and Source Corpus as a 3D force graph. `compact`
 * is the sidebar instrument: no chrome, slow orbit, and a click opens the Map.
 */
export function ConstitutionMap({
  compact = false,
  paused = false,
  onOpen,
}: {
  compact?: boolean;
  paused?: boolean;
  onOpen?: () => void;
}) {
  const { data, error, loading, refresh } = useApi<MapData>("/api/map", 600_000);
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const [showSources, setShowSources] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const controls = useRef<MapSceneControls | null>(null);

  const selected = data?.nodes.find((n) => n.id === selectedId) ?? null;
  const hasNodes = !!data && data.nodes.length > 0;

  useEffect(() => {
    if (!showSources && selected && (selected.kind === "corpus" || selected.kind === "capture")) setSelectedId(null);
  }, [showSources, selected]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // On phones the detail panel sits at the canvas bottom; keep it clear of the
  // fixed bottom navigation (72px plus the safe-area inset).
  useEffect(() => {
    if (compact || !selectedId || !window.matchMedia("(max-width: 767px)").matches) return;
    const box = boxRef.current;
    const navHeight = document.querySelector<HTMLElement>(".mobile-navigation")?.offsetHeight ?? 0;
    if (!box) return;
    const overlap = box.getBoundingClientRect().bottom - (window.innerHeight - navHeight - 12);
    if (overlap > 0) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: overlap, behavior: reduced ? "auto" : "smooth" });
    }
  }, [compact, selectedId, boxRef]);

  const jump = (id: string) => {
    setSelectedId(id);
    controls.current?.flyTo(id);
  };

  const scene = hasNodes && size.width > 0 && size.height > 0 && (
    <ConstitutionMapScene
      data={data}
      width={size.width}
      height={size.height}
      compact={compact}
      paused={paused}
      showCorpus={showSources}
      showLabels={showLabels}
      selectedId={selectedId}
      onSelect={setSelectedId}
      controlRef={controls}
    />
  );

  const status =
    loading && !data ? (
      <MapStatus text={compact ? "Charting…" : "Charting your constitution…"} />
    ) : error && !data ? (
      compact ? (
        <MapStatus text="Map offline" />
      ) : (
        <div role="alert" className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-xl bg-white p-5 text-sm text-ink shadow-xl">
            <p className="font-semibold">Your map could not be loaded.</p>
            <p className="mt-1 text-ink-dim">Your constitution in Notion hasn’t changed.</p>
            <details className="mt-2">
              <summary className="cursor-pointer">Connection details</summary>
              <p className="mt-2 break-words">{error}</p>
            </details>
            <button className="btn btn-secondary mt-3" onClick={refresh}>
              Retry map
            </button>
          </div>
        </div>
      )
    ) : data && !hasNodes ? (
      <MapStatus text="Nothing to map yet" />
    ) : null;

  if (compact) {
    return (
      <div ref={boxRef} className="relative h-full w-full overflow-hidden">
        {scene}
        {status}
        {onOpen && (
          <button
            onClick={onOpen}
            aria-label="Open your constitution map"
            className="absolute inset-0 z-10 cursor-pointer"
          />
        )}
      </div>
    );
  }

  const counts = data?.counts;
  return (
    <section aria-label="Constitution map" className="space-y-3">
      <div
        ref={boxRef}
        className="map-room relative h-[62svh] min-h-[420px] overflow-hidden rounded-2xl md:h-[70vh]"
      >
        {scene}
        {status}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-2 p-3">
          <p className="pointer-events-auto rounded-lg bg-[#101215]/60 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[#c9cbc6] backdrop-blur-sm">
            {counts
              ? [
                  `${counts.positions} positions`,
                  `${counts.corpus} corpus`,
                  counts.captures ? `${counts.captures} captures` : null,
                  `${counts.domains} domains`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Constitution map"}
            {error && data && " · sync needs attention"}
          </p>
          <div className="pointer-events-auto flex flex-wrap gap-2">
            <button className={mapButton} aria-pressed={showSources} onClick={() => setShowSources((v) => !v)}>
              Sources
            </button>
            <button className={mapButton} aria-pressed={showLabels} onClick={() => setShowLabels((v) => !v)}>
              Labels
            </button>
            <button
              className={mapButton}
              onClick={() => {
                setSelectedId(null);
                controls.current?.resetView();
              }}
              disabled={!hasNodes}
            >
              Reset view
            </button>
          </div>
        </div>
        {hasNodes && (
          <Legend
            showSources={showSources}
            className="pointer-events-none absolute bottom-3 left-3 z-10 hidden rounded-lg bg-[#101215]/60 px-3 py-2 text-[#c9cbc6] backdrop-blur-sm sm:block"
          />
        )}
        <AnimatePresence>
          {selected && data && (
            <DetailPanel node={selected} data={data} onClose={() => setSelectedId(null)} onJump={jump} />
          )}
        </AnimatePresence>
      </div>
      {hasNodes && <Legend showSources={showSources} light className="px-1 text-ink-dim sm:hidden" />}
      <p className="hidden px-1 text-xs text-ink-dim sm:block">
        Drag to orbit, scroll to zoom, click a node to inspect it.
      </p>
    </section>
  );
}
