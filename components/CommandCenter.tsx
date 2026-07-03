"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovalQueue } from "./ApprovalQueue";
import { BootSequence } from "./BootSequence";
import { CalibrationPanel } from "./CalibrationPanel";
import { CommandPalette, PaletteAction } from "./CommandPalette";
import { KpiPanel } from "./KpiPanel";
import { Nova } from "./Nova";
import { novaState } from "./novaVoice";
import { QueuePanel } from "./QueuePanel";
import { AutomationsPanel, InputsPanel, PositionsPanel } from "./SidePanels";
import { Ticker } from "./Ticker";
import { postAction, useApi } from "./useApi";
import { ContentItem, PanelsData, PlatformKey, QueueData, formatSgt, twinPulse } from "./types";

export function CommandCenter() {
  const queue = useApi<QueueData>("/api/queue", 60_000);
  const panels = useApi<PanelsData>("/api/panels", 300_000);
  const [tab, setTab] = useState<PlatformKey | "all">("all");
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  // Optimistic removal from the approval queue, with restore on failure
  const removeDraft = useCallback(
    (id: string) => {
      queue.setData((d) => (d ? { ...d, drafts: d.drafts.filter((x) => x.id !== id) } : d));
      // Refresh shortly after so Approved/Queued lanes pick the item up
      setTimeout(() => queue.refresh(), 1500);
    },
    [queue]
  );

  const restoreDraft = useCallback(
    (_id: string, item: ContentItem, message: string) => {
      queue.setData((d) =>
        d && !d.drafts.some((x) => x.id === item.id) ? { ...d, drafts: [item, ...d.drafts] } : d
      );
      toast(message);
    },
    [queue, toast]
  );

  const data = queue.data;
  const failures = panels.data?.publishFailures ?? [];

  // Nova's mood + rotating line, from real pipeline stats
  const nova = useMemo(() => novaState(data), [data]);
  const [novaIdx, setNovaIdx] = useState(0);
  useEffect(() => {
    setNovaIdx(0);
    if (nova.lines.length <= 1) return;
    const id = setInterval(() => setNovaIdx((i) => (i + 1) % nova.lines.length), 14_000);
    return () => clearInterval(id);
  }, [nova]);

  const tickerLines = useMemo(() => {
    const lines: string[] = [];
    if (!data) return ["ISAAC TWIN // COMMAND CENTER"];
    if (data.drafts.length > 0) lines.push(`${data.drafts.length} draft${data.drafts.length === 1 ? "" : "s"} awaiting review`);
    for (const q of data.queued.slice(0, 4)) {
      lines.push(`${q.platformLabel} post queued — ${formatSgt(q.scheduledAt)}`);
    }
    if (data.approved.length > 0) lines.push(`${data.approved.length} approved, awaiting scheduler`);
    if (data.manual.length > 0) lines.push(`${data.manual.length} item${data.manual.length === 1 ? "" : "s"} ready to post — copy from the queue`);
    for (const p of data.posted.slice(0, 2)) lines.push(`Posted: ${p.title || p.platformLabel}`);
    if (failures.length > 0) lines.push(`⚠ ${failures.length} publish failure${failures.length === 1 ? "" : "s"} — check queue`);
    if (lines.length === 0) lines.push("Systems nominal — queue clear");
    return lines;
  }, [data, failures.length]);

  // Command palette actions (PRD §5.3 #3)
  const visibleDrafts = (data?.drafts ?? []).filter((d) => tab === "all" || d.platform === tab);
  const topDraft = visibleDrafts[0];
  const firstApproved = data?.approved?.[0];

  const paletteActions: PaletteAction[] = useMemo(() => {
    const acts: PaletteAction[] = [];
    if (topDraft) {
      acts.push({
        id: "approve-top",
        label: `Approve top draft (${topDraft.platformLabel})`,
        hint: "APPROVE",
        run: async () => {
          removeDraft(topDraft.id);
          twinPulse("approve");
          const res = await postAction(`/api/items/${topDraft.id}/approve`);
          if (!res.ok) restoreDraft(topDraft.id, topDraft, res.error ?? "Approve failed");
        },
      });
      acts.push({
        id: "reject-top",
        label: `Reject top draft (${topDraft.platformLabel})`,
        hint: "REJECT",
        run: async () => {
          removeDraft(topDraft.id);
          const res = await postAction(`/api/items/${topDraft.id}/reject`);
          if (!res.ok) restoreDraft(topDraft.id, topDraft, res.error ?? "Reject failed");
        },
      });
      acts.push({
        id: "open-top",
        label: "Open top draft in Notion",
        hint: "↗",
        run: () => window.open(topDraft.notionUrl, "_blank"),
      });
    }
    if (firstApproved) {
      acts.push({
        id: "publish-next",
        label: `Publish next slot — ${firstApproved.title || firstApproved.platformLabel}`,
        hint: "SCHEDULE",
        run: async () => {
          const res = await postAction(`/api/items/${firstApproved.id}/publish-next`);
          if (res.ok) {
            twinPulse("approve");
            queue.refresh();
          } else {
            twinPulse("error");
            toast(res.error ?? "Publish failed");
          }
        },
      });
    }
    for (const t of ["all", "x", "linkedin", "ig-story", "ig-carousel"] as const) {
      acts.push({
        id: `tab-${t}`,
        label: `Show ${t === "all" ? "all platforms" : t}`,
        hint: "FILTER",
        run: () => setTab(t),
      });
    }
    acts.push({ id: "refresh", label: "Refresh data", hint: "SYNC", run: () => { queue.refresh(); panels.refresh(); } });
    acts.push({
      id: "logout",
      label: "Log out",
      run: async () => {
        await postAction("/api/auth/logout");
        window.location.href = "/login";
      },
    });
    return acts;
  }, [topDraft, firstApproved, removeDraft, restoreDraft, queue, panels, toast]);

  return (
    <div className="min-h-screen">
      <BootSequence />
      <CommandPalette actions={paletteActions} />

      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-hairline bg-panel/80 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate font-sans text-sm font-semibold tracking-wide text-ink sm:text-base">
            ISAAC TWIN <span className="text-ink-dim">// COMMAND CENTER</span>
          </h1>
          <p className="font-mono text-[9px] tracking-[0.2em] text-ink-dim/70">
            {data ? `SYNCED ${formatSgt(data.fetchedAt)} SGT` : "CONNECTING…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              await postAction("/api/auth/logout");
              window.location.href = "/login";
            }}
            className="hidden border border-hairline px-3 py-1.5 font-mono text-[10px] tracking-wider text-ink-dim hover:text-ink sm:block"
          >
            LOCK
          </button>
        </div>
      </header>

      <Ticker lines={tickerLines} />

      {/* Publish failure banner */}
      {failures.length > 0 && (
        <div className="border-b border-oxbright/40 bg-oxblood/20 px-4 py-2 sm:px-6">
          <p className="font-mono text-xs text-ink">
            ⚠ {failures.length} PUBLISH FAILURE{failures.length === 1 ? "" : "S"} —{" "}
            {failures[0].platform ?? ""} {failures[0].notes?.slice(0, 80)}
            {failures[0].itemUrl && (
              <a href={failures[0].itemUrl} target="_blank" rel="noreferrer" className="ml-2 underline">
                OPEN ↗
              </a>
            )}
          </p>
        </div>
      )}

      {queue.error && (
        <div className="border-b border-amber/40 bg-amber/10 px-4 py-2 sm:px-6">
          <p className="font-mono text-xs text-ink">{queue.error}</p>
        </div>
      )}

      <main className="mx-auto max-w-6xl p-4 sm:p-6">
        {/* NOVA — the twin, centre stage */}
        <section aria-label="Nova" className="mb-6 flex justify-center">
          <Nova mood={nova.mood} line={nova.lines[novaIdx % nova.lines.length]} />
        </section>

        {/* Weekly calibration — the loop that keeps the Constitution alive */}
        <section aria-label="Weekly calibration" className="mb-6">
          <CalibrationPanel onToast={toast} />
        </section>

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          {queue.loading && !data ? (
            <div className="border border-hairline bg-panel p-8 text-center">
              <p className="font-mono text-xs tracking-[0.2em] text-ink-dim">LOADING DRAFTS…</p>
            </div>
          ) : (
            <ApprovalQueue
              drafts={data?.drafts ?? []}
              tab={tab}
              onTab={setTab}
              onRemoved={removeDraft}
              onError={restoreDraft}
              onToast={toast}
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <QueuePanel
            approved={data?.approved ?? []}
            queued={data?.queued ?? []}
            posted={data?.posted ?? []}
            manual={data?.manual ?? []}
            rejected={data?.rejected ?? []}
            index={1}
            onChanged={() => queue.refresh()}
            onError={toast}
          />
          <KpiPanel index={2} />
          <PositionsPanel data={panels.data?.positions} index={3} />
          <InputsPanel inbox={panels.data?.inbox} wiki={panels.data?.wiki} index={4} />
          <AutomationsPanel index={5} />
        </div>
        </div>
      </main>

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[95] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto border border-oxbright/50 bg-panel px-4 py-2.5 shadow-xl">
            <p className="font-mono text-xs text-ink">{t.message}</p>
          </div>
        ))}
      </div>

      <footer className="px-4 pb-6 text-center sm:px-6">
        <p className="font-mono text-[9px] tracking-[0.2em] text-ink-dim/50">
          ⌘K COMMAND · LONG-PRESS ON MOBILE · NOTION IS THE SOURCE OF TRUTH
        </p>
      </footer>
    </div>
  );
}
