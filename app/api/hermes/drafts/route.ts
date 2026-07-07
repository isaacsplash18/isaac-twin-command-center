/**
 * POST /api/hermes/drafts — draft creation bridge (Phase 7 —
 * docs/hermes-calibration-plan.md §4.4). Machine lane only: authenticated via
 * `Authorization: Bearer ${HERMES_API_TOKEN}` (lib/machine-auth.ts), NOT the
 * human session cookie. Self-authenticates — `/api/hermes/` is already in
 * middleware.ts's PUBLIC_PREFIXES (Phase 5), no middleware change needed here.
 *
 * Creates a page in the right content DB (X / LinkedIn / IG Story / IG
 * Carousel) with Status: Draft — the app's existing "pending review" state.
 * The draft appears in the approval queue with zero UI changes. This route
 * NEVER publishes and NEVER sets any status other than Draft.
 *
 * Validation and Notion writes live in lib/items.ts `createDraft()`; this
 * route only handles auth, request parsing, and HTTP status mapping,
 * mirroring the style of app/api/hermes/export/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { isMachineAuthorized } from "@/lib/machine-auth";
import { createDraft, DraftInputError } from "@/lib/items";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isMachineAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }

    const b = body as Record<string, unknown>;
    const humanizerStatus = ["passed", "failed", "unknown"].includes(b.humanizerStatus as string)
      ? (b.humanizerStatus as "passed" | "failed" | "unknown")
      : undefined;
    const createdBy = ["hermes", "agent"].includes(b.createdBy as string)
      ? (b.createdBy as "hermes" | "agent")
      : undefined;

    const result = await createDraft({
      platform: String(b.platform ?? ""),
      title: String(b.title ?? ""),
      body: String(b.body ?? ""),
      sourcePositionIds: Array.isArray(b.sourcePositionIds) ? b.sourcePositionIds.map(String) : undefined,
      sourceWorkflow: b.sourceWorkflow != null ? String(b.sourceWorkflow) : undefined,
      humanizerStatus,
      createdBy,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof DraftInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/hermes/drafts failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Draft creation failed" },
      { status: 500 }
    );
  }
}
