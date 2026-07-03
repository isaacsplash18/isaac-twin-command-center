"use client";

import { useState } from "react";
import { FrameCard } from "./FrameCard";
import { useApi } from "./useApi";
import { twinPulse } from "./types";

/**
 * Weekly Calibration — the most important panel. Surfaces this week's
 * Weekly Positions Survey questions, takes Isaac's verdict + answer, writes
 * them back into the survey page (where the Sunday review reads them), and
 * calibrates linked positions immediately on Confirm/Reject.
 */

interface SurveyQuestion {
  number: number;
  title: string;
  tag: string | null;
  guess: string;
  why: string;
  positionUrl: string | null;
  positionPageId: string | null;
  answerBlockId: string | null;
  existingAnswer: string;
}

interface Survey {
  pageUrl: string;
  roundIntro: string;
  questions: SurveyQuestion[];
}

const VERDICTS = ["Confirm", "Sharpen", "Reject"] as const;
type Verdict = (typeof VERDICTS)[number];

export function CalibrationPanel({ onToast }: { onToast: (message: string) => void }) {
  const { data, error, loading, refresh } = useApi<Survey>("/api/calibration", 300_000);

  const open = (data?.questions ?? []).filter((q) => !q.existingAnswer && q.answerBlockId);
  const answered = (data?.questions ?? []).filter((q) => q.existingAnswer);

  return (
    <FrameCard index={0} className="p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.2em] text-oxbright">
          WEEKLY CALIBRATION
          {open.length > 0 && <span className="ml-2 text-ink">{open.length} OPEN</span>}
        </h2>
        {data && (
          <a
            href={data.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[9px] tracking-wider text-ink-dim underline decoration-hairline underline-offset-4 hover:text-ink"
          >
            SURVEY IN NOTION ↗
          </a>
        )}
      </div>

      {data?.roundIntro && (
        <p className="mt-2 font-serif text-[13px] italic leading-relaxed text-ink-dim">{data.roundIntro}</p>
      )}
      {error && <p className="mt-3 font-mono text-xs text-oxbright">{error}</p>}
      {loading && !data && <p className="mt-3 font-mono text-xs text-ink-dim">Reading the survey…</p>}

      {data && open.length === 0 && (
        <p className="mt-3 font-mono text-xs tracking-[0.15em] text-phosphor">
          CALIBRATED — ALL QUESTIONS ANSWERED THIS ROUND.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-4">
        {open.map((q) => (
          <Question key={q.answerBlockId} q={q} onToast={onToast} onSubmitted={refresh} />
        ))}
      </div>

      {answered.length > 0 && (
        <details className="mt-4 border-t border-hairline-faint pt-2">
          <summary className="cursor-pointer font-mono text-[9px] tracking-[0.2em] text-ink-dim">
            ANSWERED THIS ROUND ({answered.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {answered.map((q) => (
              <li key={q.number} className="text-sm">
                <span className="text-ink">{q.title}</span>
                <p className="mt-0.5 font-serif text-[13px] leading-relaxed text-ink-dim">{q.existingAnswer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </FrameCard>
  );
}

function Question({
  q,
  onToast,
  onSubmitted,
}: {
  q: SurveyQuestion;
  onToast: (message: string) => void;
  onSubmitted: () => void;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  const submit = async () => {
    if (!text.trim()) {
      onToast("Write your actual view — messy is fine.");
      return;
    }
    setState("busy");
    try {
      const res = await fetch("/api/calibration/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answerBlockId: q.answerBlockId,
          text,
          verdict,
          positionPageId: q.positionPageId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setState("done");
      twinPulse("approve");
      onToast(json.calibrated ? "ANSWER SAVED — POSITION CALIBRATED" : "ANSWER SAVED TO THE SURVEY");
      setTimeout(onSubmitted, 1200);
    } catch (err) {
      setState("idle");
      twinPulse("error");
      onToast(err instanceof Error ? err.message : "Submit failed");
    }
  };

  if (state === "done") {
    return (
      <div className="border border-phosphor/30 bg-phosphor/5 p-3">
        <p className="font-mono text-[10px] tracking-[0.15em] text-phosphor">✓ {q.title.toUpperCase()}</p>
      </div>
    );
  }

  return (
    <div className="border border-hairline-faint p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[10px] text-ink-dim">{q.number.toString().padStart(2, "0")}</span>
        <h3 className="text-[15px] font-semibold text-ink">{q.title}</h3>
        {q.tag && (
          <span
            className={`font-mono text-[9px] tracking-wider ${
              q.tag.toLowerCase() === "contested" ? "text-oxbright" : "text-amber"
            }`}
          >
            {q.tag.toUpperCase()}
          </span>
        )}
      </div>

      {q.guess && <p className="mt-2 font-serif text-[14px] leading-relaxed text-ink">{q.guess}</p>}
      {q.why && <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">Why it&apos;s flagged: {q.why}</p>}
      {q.positionUrl && (
        <a
          href={q.positionUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block font-mono text-[9px] tracking-wider text-ink-dim underline decoration-hairline underline-offset-4 hover:text-ink"
        >
          LINKED POSITION ↗
        </a>
      )}

      <div className="mt-3 flex gap-px">
        {VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVerdict(verdict === v ? null : v)}
            className={`px-3 py-1.5 font-mono text-[10px] tracking-[0.15em] transition-colors ${
              verdict === v
                ? v === "Reject"
                  ? "border border-oxbright/60 bg-oxblood/30 text-ink"
                  : "border border-ink/40 bg-ink/10 text-ink"
                : "border border-hairline text-ink-dim hover:text-ink"
            }`}
          >
            {v.toUpperCase()}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your real view, in your own words. Messy is fine."
        rows={3}
        className="mt-2 w-full resize-y border border-hairline bg-ground p-3 font-serif text-[14px] leading-relaxed text-ink placeholder:text-ink-dim/50 focus:border-ink/40 focus:outline-none"
      />

      <button
        type="button"
        disabled={state === "busy"}
        onClick={submit}
        className="mt-2 w-full border border-oxbright/60 bg-oxblood/30 px-4 py-2.5 font-mono text-xs tracking-[0.2em] text-ink hover:bg-oxblood/50 active:bg-oxblood/70 disabled:opacity-50 sm:w-auto sm:px-8"
      >
        {state === "busy" ? "CALIBRATING…" : "SUBMIT"}
      </button>
    </div>
  );
}
