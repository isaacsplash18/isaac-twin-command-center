"use client";

import { useState } from "react";
import { Nova, NovaMood } from "./Nova";
import { useApi } from "./useApi";
import { twinPulse } from "./types";

/**
 * Centre stage: Nova asks this week's calibration questions one at a time.
 * The question floats over the lower part of the hologram — she poses it,
 * you answer, SUBMIT writes to the survey page and calibrates the linked
 * position, and she moves to the next. When the round is clear she returns
 * to her usual commentary.
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

export function NovaStage({
  mood,
  idleLine,
  onToast,
}: {
  mood: NovaMood;
  idleLine: string;
  onToast: (message: string) => void;
}) {
  const { data, refresh } = useApi<Survey>("/api/calibration", 300_000);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (data?.questions ?? []).filter(
    (q) => q.answerBlockId && !q.existingAnswer && !submitted.includes(q.answerBlockId)
  );
  // Skipped questions rotate to the back of the queue
  const ordered = [
    ...open.filter((q) => !skipped.includes(q.answerBlockId!)),
    ...open.filter((q) => skipped.includes(q.answerBlockId!)),
  ];
  const q = ordered[0] ?? null;
  const asking = q !== null;

  // While a question is up, the floating card is Nova's voice — keep the
  // typed caption blank so it doesn't ghost through the card.
  const line = asking ? "" : idleLine;

  const next = () => {
    setVerdict(null);
    setText("");
  };

  const skip = () => {
    if (!q?.answerBlockId) return;
    setSkipped((s) => (s.includes(q.answerBlockId!) ? s : [...s, q.answerBlockId!]));
    next();
  };

  const submit = async () => {
    if (!q?.answerBlockId) return;
    if (!text.trim()) {
      onToast("Write your actual view — messy is fine.");
      return;
    }
    setBusy(true);
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
      twinPulse("approve");
      onToast(json.calibrated ? "ANSWER SAVED — POSITION CALIBRATED" : "ANSWER SAVED TO THE SURVEY");
      setSubmitted((s) => [...s, q.answerBlockId!]);
      next();
      setTimeout(refresh, 1500);
    } catch (err) {
      twinPulse("error");
      onToast(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex w-full flex-col items-center">
      <Nova mood={asking ? "neutral" : mood} line={line} />

      {asking && q && (
        // The question floats over the hologram's lower half — Nova is asking.
        <div className="relative z-10 -mt-40 w-full max-w-xl border border-hairline bg-panel/90 p-4 shadow-[0_0_40px_rgba(0,0,0,0.6)] sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-[9px] tracking-[0.25em] text-oxbright">
              CALIBRATION · {open.length} LEFT THIS ROUND
            </span>
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

          <h3 className="mt-1.5 text-base font-semibold text-ink">{q.title}</h3>
          {q.guess && <p className="mt-1.5 font-serif text-[14px] leading-relaxed text-ink">{q.guess}</p>}
          {q.why && <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{q.why}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-px">
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
            {q.positionUrl && (
              <a
                href={q.positionUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto font-mono text-[9px] tracking-wider text-ink-dim underline decoration-hairline underline-offset-4 hover:text-ink"
              >
                POSITION ↗
              </a>
            )}
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your real view, in your own words. Messy is fine."
            rows={3}
            className="mt-2 w-full resize-y border border-hairline bg-ground p-3 font-serif text-[14px] leading-relaxed text-ink placeholder:text-ink-dim/50 focus:border-ink/40 focus:outline-none"
          />

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex-1 border border-oxbright/60 bg-oxblood/30 px-4 py-2.5 font-mono text-xs tracking-[0.2em] text-ink hover:bg-oxblood/50 active:bg-oxblood/70 disabled:opacity-50"
            >
              {busy ? "CALIBRATING…" : "SUBMIT"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={skip}
              className="border border-hairline px-4 py-2.5 font-mono text-xs tracking-[0.15em] text-ink-dim hover:text-ink disabled:opacity-50"
            >
              LATER
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
