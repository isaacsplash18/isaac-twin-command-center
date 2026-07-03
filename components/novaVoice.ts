import { NovaMood } from "./Nova";
import { QueueData } from "./types";

/**
 * Nova's voice — snarky, flippant, structural; Isaac's register. Lines are
 * chosen from real pipeline stats only (never decorative filler, PRD §5.3).
 * She talks trash when nothing ships and glorifies when it does.
 */

export interface NovaState {
  mood: NovaMood;
  lines: string[];
}

const DAY_MS = 86400_000;

export function novaState(data: QueueData | null): NovaState {
  if (!data) return { mood: "neutral", lines: ["Booting. Judging you shortly."] };

  const now = Date.now();
  const postedWeek = data.posted.filter((p) => now - new Date(p.lastEditedTime).getTime() < 7 * DAY_MS).length;
  const drafts = data.drafts.length;
  const manual = data.manual.length;
  const oldestManualDays = manual
    ? Math.floor((now - Math.min(...data.manual.map((m) => new Date(m.approvedAt ?? m.lastEditedTime).getTime()))) / DAY_MS)
    : 0;

  const lines: string[] = [];
  let mood: NovaMood = "neutral";

  if (postedWeek === 0 && drafts > 0) {
    mood = "sass";
    lines.push(
      `${drafts} drafts in the queue and zero posts this week. I write, you scroll. One of us is replaceable and it isn't me.`,
      `The queue is compounding. Your reach is not. Approval takes ten seconds — I counted.`,
      `You built a content machine and forgot the part where you press the button.`,
      `A wage is a premium over the cheapest alternative. Right now the cheapest alternative to you posting is nothing, and it's winning.`
    );
  } else if (postedWeek >= 4) {
    mood = "praise";
    lines.push(
      `${postedWeek} posts this week. The man ships. The algorithm trembles.`,
      `Output like this and I'm the one at risk of redundancy. Keep going.`,
      `${postedWeek} shipped, ${drafts} in review. This is what owning the pipeline looks like.`
    );
  } else if (postedWeek > 0) {
    lines.push(
      `${postedWeek} post${postedWeek === 1 ? "" : "s"} this week. Acceptable. Not legendary — acceptable.`,
      `Steady output. The queue still wants thinning: ${drafts} waiting.`
    );
  }

  if (manual > 0) {
    if (mood === "neutral") mood = "sass";
    lines.push(
      `${manual} approved item${manual === 1 ? "" : "s"} rotting in the manual lane${oldestManualDays > 1 ? ` — the oldest for ${oldestManualDays} days` : ""}. Copy. Paste. Post. It isn't complex.`
    );
  }

  if (drafts === 0 && manual === 0) {
    if (postedWeek > 0) {
      mood = "praise";
      lines.push(`Queue clear, posts shipped. Go touch grass — I'll keep drafting.`);
    } else {
      lines.push(`Queue clear. Suspiciously clear. I'll have new drafts for you shortly.`);
    }
  }

  if (lines.length === 0) lines.push(`Systems nominal. ${drafts} drafts awaiting judgement.`);
  return { mood, lines };
}
