import { NextRequest, NextResponse } from "next/server";
import { submitAnswer, Verdict } from "@/lib/calibration";

export const dynamic = "force-dynamic";

const VERDICTS: Verdict[] = ["Confirm", "Sharpen", "Reject"];

/**
 * POST /api/calibration/answer
 * body: { answerBlockId, text, verdict?, positionPageId? }
 * Writes the answer into the survey page and calibrates the linked position.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const answerBlockId = String(body?.answerBlockId ?? "");
    const text = String(body?.text ?? "");
    const verdict = VERDICTS.includes(body?.verdict) ? (body.verdict as Verdict) : null;
    const positionPageId = body?.positionPageId ? String(body.positionPageId) : null;
    if (!answerBlockId) {
      return NextResponse.json({ error: "answerBlockId required" }, { status: 400 });
    }
    if (!text.trim()) {
      return NextResponse.json({ error: "Write your actual view — messy is fine." }, { status: 400 });
    }
    const result = await submitAnswer({ answerBlockId, text, verdict, positionPageId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("POST /api/calibration/answer failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Answer submission failed" },
      { status: 500 }
    );
  }
}
