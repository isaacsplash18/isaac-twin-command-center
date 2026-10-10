"use client";

import { TrainingSection } from "./TrainingSection";

import { PlatformLogo } from "./PlatformLogo";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovalQueue } from "./ApprovalQueue";
import { CommandPalette, PaletteAction } from "./CommandPalette";
import { FrameCard } from "./FrameCard";
import { KpiPanel } from "./KpiPanel";
import { NovaStage } from "./NovaStage";
import { NovaCompanion } from "./NovaCompanion";
import { novaState } from "./novaVoice";
import { QueuePanel } from "./QueuePanel";
import { IdentityCalibrationPanel } from "./IdentityCalibrationPanel";
import { AutomationsPanel, InputsPanel, PositionsPanel } from "./SidePanels";
import { postAction, useApi } from "./useApi";
import { PanelsData, PlatformKey, QueueData, formatSgt } from "./types";

import { TrainingProgressPanel } from "./TrainingProgressPanel";
import { TrainingEvaluationPanel } from "./TrainingEvaluationPanel";
import { ApplySuggestionsPanel } from "./ApplySuggestionsPanel";

type View = "review" | "schedule" | "train" | "more";
const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: "review", label: "Review", icon: "▤" },
  { id: "schedule", label: "Schedule", icon: "▦" },
  { id: "train", label: "Train your twin", icon: "✧" },
  { id: "more", label: "More", icon: "···" },
];

export function CommandCenter() {
  const queue = useApi<QueueData>("/api/queue", 60_000);
  const panels = useApi<PanelsData>("/api/panels", 300_000);
  const [view, setView] = useState<View>("review");
  const [tab, setTab] = useState<PlatformKey | "all">("all");
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const [reviewReset, setReviewReset] = useState(0);
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
  }, []);
  const navigate = (id: View) => {
    setView(id);
    window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const update = () => {
      const hash = window.location.hash.slice(1);
      if (VIEWS.some((v) => v.id === hash)) setView(hash as View);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (!targetDraft || view !== "review") return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`draft-${targetDraft}`);
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
      setTargetDraft(null);
    });
    return () => cancelAnimationFrame(id);
  }, [targetDraft, view, tab]);
  const data = queue.data;
  const nova = useMemo(() => novaState(data), [data]);
  const failures = panels.data?.publishFailures ?? [];
  const refresh = () => {
    queue.refresh();
    panels.refresh();
  };
  const logout = async () => {
    const res = await postAction("/api/auth/logout");
    if (res.ok) window.location.href = "/login";
    else toast("Could not sign out. Please try again.");
  };
  const actions: PaletteAction[] = [
    ...VIEWS.map((v) => ({
      id: v.id,
      label: `Go to ${v.label.toLowerCase()}`,
      hint: "Navigate",
      run: () => navigate(v.id),
    })),
    ...(data?.drafts ?? []).map((d) => ({
      id: d.id,
      label: `${d.platformLabel}: ${d.title || d.body.slice(0, 100)}`,
      keywords: d.body,
      hint: "Draft",
      run: () => {
        setTab("all");
        setReviewReset((n) => n + 1);
        navigate("review");
        setTargetDraft(d.id);
      },
    })),
    { id: "refresh", label: "Refresh data", hint: "Sync", run: refresh },
    { id: "logout", label: "Sign out", run: logout },
  ];
  const headings = {
    review: [
      "Make it sound like you.",
      "Review your drafts, make a few edits, and send the good ones on their way.",
    ],
    schedule: [
      "Your publishing plan.",
      "See what’s scheduled, what needs posting, and what’s already out in the world.",
    ],
    train: [
      "A little more you.",
      "Save feedback to your Personal Constitution in Notion for your Claude routines.",
    ],
    more: [
      "The bigger picture.",
      "Your performance, knowledge library, and automation settings.",
    ],
  };
  const nav = (mobile = false) => (
    <nav
      aria-label={mobile ? "Mobile navigation" : "Main navigation"}
      className={
        mobile
          ? "mobile-navigation fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-hairline bg-white md:hidden"
          : "hidden items-center gap-1 md:flex"
      }
    >
      {VIEWS.map((v) => (
        <button
          key={v.id}
          onClick={() => navigate(v.id)}
          aria-current={view === v.id ? "page" : undefined}
          className={
            mobile
              ? `flex min-h-[72px] flex-col items-center justify-center gap-1 px-1 text-xs ${view === v.id ? "bg-oxblood/5 font-semibold text-oxblood" : "text-ink-dim"}`
              : `btn ${view === v.id ? "bg-white text-oxblood shadow-sm" : "btn-quiet"}`
          }
        >
          {mobile && (
            <span aria-hidden="true" className="text-xl">
              {v.icon}
            </span>
          )}
          {v.label}
          {!mobile && v.id === "review" && data && (
            <span className="rounded-full bg-oxblood/10 px-2 py-0.5 text-xs text-oxblood">
              {data.drafts.length}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
  return (
    <div className="min-h-screen pb-28 md:pb-8">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:p-4"
      >
        Skip to content
      </a>
      <header className="glass command-header relative z-20 border-b border-hairline-faint">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <a
            href="#review"
            onClick={() => navigate("review")}
            className="flex items-center gap-3"
          >
            <img
              src="/icons/diamond-192.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-xl"
            />
            <span className="text-base font-semibold tracking-tight">
              Isaac Twin
              <span className="mt-0.5 hidden sm:block text-xs font-normal text-ink-dim">
                Your voice, with a little help.
              </span>
            </span>
          </a>
          {nav()}
          <div className="flex items-center gap-2">
            <CommandPalette actions={actions} />
            <details className="relative">
              <summary
                aria-label="Account menu"
                className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-hairline bg-white text-sm font-semibold"
              >
                IH
              </summary>
              <div className="absolute right-0 top-13 z-40 min-w-40 rounded-xl border border-hairline bg-white p-2 shadow-lg">
                <button className="btn btn-quiet w-full" onClick={logout}>
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main
        id="main-content"
        className="mx-auto max-w-[1320px] px-4 py-5 sm:px-8 sm:py-10"
      >
        <div className="mb-5 sm:mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-oxblood">
              {VIEWS.find((v) => v.id === view)?.label}
            </p>
            <h1 className="font-sans text-3xl font-semibold tracking-tight leading-tight sm:text-5xl">
              {headings[view][0]}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-dim sm:text-base">
              {headings[view][1]}
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-dim">
            <span>
              {queue.error || data?.warning
                ? "Sync needs attention"
                : data
                  ? `Updated ${formatSgt(data.fetchedAt)} SGT`
                  : "Connecting…"}
            </span>
            <button
              className="btn btn-secondary"
              onClick={refresh}
              disabled={queue.loading}
            >
              Refresh
            </button>
          </div>
        </div>
        {(queue.error || data?.warning) && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-amber/30 bg-amber/10 p-4"
          >
            <p className="font-semibold">
              {data
                ? "Some information may be out of date"
                : "We couldn’t load your drafts"}
            </p>
            <p className="mt-1 text-sm">
              Check your connection and try again.{" "}
              {data
                ? "Available items are shown below."
                : "Your work hasn’t changed."}
            </p>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer">Connection details</summary>
              <p className="mt-2 break-words">{queue.error || data?.warning}</p>
            </details>
            <button
              className="btn btn-secondary mt-3"
              onClick={() => queue.refresh()}
            >
              Retry connection
            </button>
          </div>
        )}
        {failures.length > 0 && (
          <div
            role="status"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-oxblood/20 bg-white p-4"
          >
            <p className="text-sm">
              <strong>
                {failures.length} publishing issue
                {failures.length > 1 ? "s" : ""}
              </strong>{" "}
              need attention.
            </p>
            <button
              className="btn btn-secondary"
              onClick={() => navigate("schedule")}
            >
              View publishing issues
            </button>
          </div>
        )}
        {view === "review" && (
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="order-2 min-w-0 lg:order-1">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Needs your review</h2>
                {data && (
                  <span className="text-sm text-ink-dim">
                    {data.drafts.length} drafts · {data.queued.length} scheduled
                  </span>
                )}
              </div>
              {queue.loading && !data ? (
                <div
                  role="status"
                  className="space-y-4 rounded-2xl bg-white p-7"
                >
                  <p className="text-sm text-ink-dim">Loading your drafts…</p>
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-5 rounded bg-panel motion-safe:animate-pulse"
                      style={{ width: `${100 - i * 12}%` }}
                    />
                  ))}
                </div>
              ) : data ? (
                <ApprovalQueue
                  key={reviewReset}
                  drafts={data.drafts}
                  tab={tab}
                  onTab={setTab}
                  incomplete={!!data.warning || !!queue.error}
                  onRemoved={(id) => {
                    queue.setData((d) =>
                      d
                        ? { ...d, drafts: d.drafts.filter((x) => x.id !== id) }
                        : d,
                    );
                    queue.refresh();
                  }}
                  onUpdated={(item) =>
                    queue.setData((d) =>
                      d
                        ? {
                            ...d,
                            drafts: d.drafts.map((x) =>
                              x.id === item.id ? item : x,
                            ),
                          }
                        : d,
                    )
                  }
                  onError={(_id, _item, msg) => toast(msg)}
                  onToast={toast}
                />
              ) : null}
            </div>
            <aside className="order-1 space-y-5 lg:order-2 lg:sticky lg:top-6">
              <NovaCompanion
                mood={nova.mood}
                line={
                  data
                    ? nova.lines[0]
                    : "I’ll have your overview ready when the connection is back."
                }
                onTrain={() => navigate("train")}
              />
              <FrameCard className="hidden p-5 lg:block">
                <h2 className="font-semibold">Coming up</h2>
                {data ? (
                  <>
                    {data.manual.length > 0 && (
                      <p className="mt-3 rounded-lg bg-amber/10 p-3 text-sm">
                        {data.manual.length} approved post
                        {data.manual.length > 1 ? "s" : ""} ready for you to
                        publish manually.
                      </p>
                    )}
                    {data.queued.slice(0, 3).map((q) => (
                      <div
                        key={q.id}
                        className="mt-4 border-b border-hairline-faint pb-3"
                      >
                        <p className="text-sm font-semibold">
                          {q.title || q.platformLabel}
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-xs text-ink-dim">
                          <PlatformLogo platform={q.platform} />
                          <span>
                            {q.platformLabel} · {formatSgt(q.scheduledAt)} SGT
                          </span>
                        </p>
                      </div>
                    ))}
                    {data.queued.length === 0 && (
                      <p className="mt-3 text-sm text-ink-dim">
                        {data.warning
                          ? "Schedule information may be incomplete."
                          : "No posts scheduled yet."}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-ink-dim">
                    Schedule unavailable until connected.
                  </p>
                )}
                <button
                  className="btn btn-secondary mt-4 w-full"
                  onClick={() => navigate("schedule")}
                >
                  Open schedule →
                </button>
              </FrameCard>
            </aside>
          </div>
        )}
        {view === "schedule" && (
          <div className="space-y-5">
            {panels.error && (
              <div
                role="alert"
                className="rounded-xl border border-amber/30 bg-white p-4"
              >
                <p className="text-sm">
                  Publishing health could not be loaded.
                </p>
                <button
                  className="btn btn-secondary mt-2"
                  onClick={() => panels.refresh()}
                >
                  Retry health check
                </button>
              </div>
            )}
            {failures.length > 0 && (
              <FrameCard className="p-5">
                <h2 className="panel-heading">Publishing issues</h2>
                {failures.map((f) => (
                  <div
                    key={f.id}
                    className="mt-4 border-t border-hairline-faint pt-4"
                  >
                    <p className="text-sm font-semibold">
                      {f.platform || "Publishing"} · {formatSgt(f.at)}
                    </p>
                    <p className="mt-2 break-words text-sm text-ink-dim">
                      {f.notes}
                    </p>
                    {f.itemUrl && (
                      <a
                        className="btn btn-secondary mt-2"
                        href={f.itemUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open post in Notion ↗
                      </a>
                    )}
                  </div>
                ))}
              </FrameCard>
            )}
            {data ? (
              <QueuePanel
                approved={data.approved}
                queued={data.queued}
                posted={data.posted}
                manual={data.manual}
                rejected={data.rejected}
                index={0}
                onChanged={() => queue.refresh()}
                onError={toast}
              />
            ) : (
              !queue.error && <p role="status">Loading schedule…</p>
            )}
          </div>
        )}
        {view === "train" && (
          <div className="mx-auto w-full max-w-5xl space-y-3">
            <p className="mb-5 text-sm leading-relaxed text-ink-dim">Start with Compare writing. Open the other sections when you want to update your views, review suggestions, or check progress.</p>
            <TrainingSection title="Compare writing" description="Choose which draft sounds more like you. Explain why, and optionally save a preference for future drafts.">
              <TrainingEvaluationPanel index={0} />
            </TrainingSection>
            <TrainingSection title="Share your views" description="Answer Nova’s check-in questions. Your answers go to Notion for the weekly review of your positions.">
              <FrameCard className="p-5 sm:p-7">
                <h2 className="panel-heading">Check in with Nova</h2>
                <NovaStage mood={nova.mood} idleLine="You’re ready for your next check-in." onToast={toast} />
              </FrameCard>
            </TrainingSection>
            <TrainingSection title="Review suggested changes" description="Review proposed changes to your twin’s views and writing rules. Accept what fits or reject what doesn’t.">
              <IdentityCalibrationPanel index={1} onError={toast} />
            </TrainingSection>
            <TrainingSection title="Update your Notion guidance" description="Apply suggestions you’ve already accepted. Preview the exact wording before adding it to your Notion source.">
              <ApplySuggestionsPanel />
            </TrainingSection>
            <TrainingSection title="Progress and past feedback" description="See draft approval rates, check what routines used, and decide which past corrections should become lasting preferences.">
              <TrainingProgressPanel index={2} />
            </TrainingSection>
          </div>
        )}
        {view === "more" && (
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <KpiPanel index={0} />
            <div className="space-y-6">
              {panels.error ? (
                <FrameCard className="p-5">
                  <p role="alert">Your library could not be loaded.</p>
                  <button
                    className="btn btn-secondary mt-3"
                    onClick={() => panels.refresh()}
                  >
                    Retry library
                  </button>
                </FrameCard>
              ) : (
                <>
                  <PositionsPanel data={panels.data?.positions} index={0} />
                  {panels.data ? (
                    <InputsPanel
                      inbox={panels.data.inbox}
                      wiki={panels.data.wiki}
                      index={0}
                    />
                  ) : (
                    <p role="status">Loading library…</p>
                  )}
                </>
              )}
              <AutomationsPanel index={0} />
            </div>
          </div>
        )}
      </main>
      {nav(true)}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-24 z-50 mx-auto flex max-w-md flex-col gap-2 px-4 md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-hairline bg-ink p-4 text-sm leading-relaxed text-white shadow-xl"
          >
            <p className="flex-1">{t.message}</p>
            <button
              aria-label="Dismiss notification"
              className="-m-2 flex h-11 w-11 items-center justify-center"
              onClick={() =>
                setToasts((items) => items.filter((x) => x.id !== t.id))
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
