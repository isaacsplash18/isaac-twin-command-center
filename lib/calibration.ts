/**
 * Weekly Positions Survey integration — the calibration loop that keeps the
 * Constitution alive.
 *
 * The survey lives on a Notion page (child of the Personal Constitution).
 * Structure per question, under the "This week" heading:
 *
 *   **1. Question title** [tag]
 *   The guess: …
 *   Why it's flagged: …
 *   Position: <link to Positions Library page>   (optional)
 *   Your answer:                                  (Isaac writes here)
 *
 * Submitting from the command center writes the answer into the
 * "Your answer:" paragraph (same contract the Sunday review reads), and —
 * when a verdict is given on a question with a linked Position — updates
 * the Positions Library deterministically:
 *
 *   Confirm → Confidence Confirmed, Status Active, Last validated = today
 *   Reject  → Confidence Contested, Status Needs validation, Last validated
 *   Sharpen → Last validated only (the Sunday review rewrites the nuance)
 */

import { listBlocks, notionFetch, plainText } from "./notion";
import { CalibrationAction, logCalibrationEvent } from "./calibration-events";

const DEFAULT_SURVEY_PAGE = "36f1fec9ef8381ceb927eca8fa3c5ed6";

export function surveyPageId(): string {
  return (process.env.NOTION_SURVEY_PAGE || DEFAULT_SURVEY_PAGE).replace(/-/g, "");
}

export type Verdict = "Confirm" | "Sharpen" | "Reject";

export interface SurveyQuestion {
  number: number;
  title: string;
  tag: string | null;
  guess: string;
  why: string;
  positionUrl: string | null;
  positionPageId: string | null;
  /** Block id of the "Your answer:" paragraph — the write target. */
  answerBlockId: string | null;
  /** Anything already written after "Your answer:". */
  existingAnswer: string;
}

export interface Survey {
  pageUrl: string;
  roundIntro: string;
  questions: SurveyQuestion[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function extractPageLink(richText: Json[]): { url: string | null; pageId: string | null } {
  for (const rt of richText ?? []) {
    const href: string | undefined = rt.href ?? rt.text?.link?.url;
    if (href) {
      const m = href.match(/([0-9a-f]{32})/i) ?? href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      return { url: href, pageId: m ? m[1].replace(/-/g, "") : null };
    }
    if (rt.type === "mention" && rt.mention?.page?.id) {
      return { url: rt.href ?? null, pageId: String(rt.mention.page.id).replace(/-/g, "") };
    }
  }
  return { url: null, pageId: null };
}

export async function readSurvey(): Promise<Survey> {
  const pageId = surveyPageId();
  const blocks = await listBlocks(pageId);

  const questions: SurveyQuestion[] = [];
  let roundIntro = "";
  let inThisWeek = false;
  let current: SurveyQuestion | null = null;

  for (const b of blocks) {
    const type = b.type;
    const text = plainText(b[type]?.rich_text).trim();

    if (type.startsWith("heading")) {
      const heading = text.toLowerCase();
      if (heading.includes("this week")) {
        inThisWeek = true;
        continue;
      }
      if (inThisWeek && (heading.includes("answered") || heading.includes("archive"))) break;
      continue;
    }
    if (!inThisWeek || !text) continue;

    const qStart = text.match(/^(\d+)\.\s+(.*)$/);
    if (qStart && type === "paragraph") {
      if (current) questions.push(current);
      const tagMatch = qStart[2].match(/\[(.+?)\]\s*$/);
      current = {
        number: Number(qStart[1]),
        title: tagMatch ? qStart[2].slice(0, tagMatch.index).trim() : qStart[2].trim(),
        tag: tagMatch ? tagMatch[1] : null,
        guess: "",
        why: "",
        positionUrl: null,
        positionPageId: null,
        answerBlockId: null,
        existingAnswer: "",
      };
      continue;
    }
    if (!current) {
      // Italic intro line under "This week", before the first question
      if (!roundIntro && type === "paragraph") roundIntro = text;
      continue;
    }
    if (/^the guess:/i.test(text)) current.guess = text.replace(/^the guess:\s*/i, "");
    else if (/^why it'?s flagged:/i.test(text)) current.why = text.replace(/^why it'?s flagged:\s*/i, "");
    else if (/^position:/i.test(text)) {
      const link = extractPageLink(b[type]?.rich_text);
      current.positionUrl = link.url;
      current.positionPageId = link.pageId;
    } else if (/^your answer:/i.test(text)) {
      current.answerBlockId = b.id;
      current.existingAnswer = text.replace(/^your answer:\s*/i, "").trim();
    }
  }
  if (current) questions.push(current);

  return {
    pageUrl: `https://www.notion.so/${pageId}`,
    roundIntro,
    questions,
  };
}

/** Write the answer into the survey page and calibrate the linked position. */
export async function submitAnswer(opts: {
  answerBlockId: string;
  text: string;
  verdict: Verdict | null;
  positionPageId: string | null;
}): Promise<{ calibrated: boolean }> {
  const answer = opts.text.trim();
  if (!answer && !opts.verdict) throw new Error("Empty answer");

  // 1. Write the answer where the Sunday review reads it
  const composed = `Your answer: ${opts.verdict ? `${opts.verdict} — ` : ""}${answer}`;
  await notionFetch(`/blocks/${opts.answerBlockId}`, {
    method: "PATCH",
    body: JSON.stringify({
      paragraph: {
        rich_text: [
          { type: "text", text: { content: "Your answer: " }, annotations: { bold: true } },
          ...(opts.verdict
            ? [{ type: "text", text: { content: `${opts.verdict} — ` }, annotations: { italic: true } }]
            : []),
          { type: "text", text: { content: answer.slice(0, 1900) } },
        ],
      },
    }),
  });

  // 2. Deterministic calibration of the linked position, when a verdict is given
  let calibrated = false;
  if (opts.verdict && opts.positionPageId) {
    const today = new Date().toISOString().slice(0, 10);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties: Record<string, any> = { "Last validated": { date: { start: today } } };
    if (opts.verdict === "Confirm") {
      properties["Confidence"] = { select: { name: "Confirmed" } };
      properties["Status"] = { select: { name: "Active" } };
    } else if (opts.verdict === "Reject") {
      properties["Confidence"] = { select: { name: "Contested" } };
      properties["Status"] = { select: { name: "Needs validation" } };
    }
    try {
      await notionFetch(`/pages/${opts.positionPageId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });
      calibrated = true;
    } catch (err) {
      // The answer is saved either way; the Sunday review will still calibrate.
      console.warn("Calibration write to position failed:", err);
    }
  }

  // One CalibrationEvent per submission (Phase 3): the verdict (lowercased)
  // when given, else "submit". Confirm is treated as already-applied by the
  // deterministic calibration above; everything else stays pending review.
  const action: CalibrationAction = opts.verdict ? (opts.verdict.toLowerCase() as CalibrationAction) : "submit";
  const inferredDelta = !opts.verdict
    ? "answer-recorded"
    : opts.verdict === "Confirm"
      ? "position-confirmed"
      : opts.verdict === "Sharpen"
        ? "position-sharpened"
        : "position-contested";
  await logCalibrationEvent({
    action,
    objectType: "calibration_card",
    objectId: opts.answerBlockId,
    rawUserText: answer,
    affectedPositionIds: opts.positionPageId ? [opts.positionPageId] : [],
    inferredDelta,
    status: opts.verdict === "Confirm" ? "accepted" : "pending",
  });

  return { calibrated };
}
