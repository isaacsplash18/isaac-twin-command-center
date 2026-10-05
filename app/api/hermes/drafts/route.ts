/**
 * /api/hermes/drafts — draft bridge (machine lane, Bearer ${HERMES_API_TOKEN},
 * NOT the human session cookie). Self-authenticates — `/api/hermes/` is already
 * in middleware.ts's PUBLIC_PREFIXES (Phase 5), no middleware change here.
 *
 * POST — draft creation bridge (Phase 7 — docs/hermes-calibration-plan.md §4.4).
 *   Creates a page in the right content DB (X / LinkedIn / IG Story / IG
 *   Carousel) with Status: Draft — the app's existing "pending review" state.
 *   The draft appears in the approval queue with zero UI changes. NEVER
 *   publishes and NEVER sets any status other than Draft. Validation and Notion
 *   writes live in lib/items.ts `createDraft()`; this route only handles auth,
 *   request parsing, and HTTP status mapping (style of app/api/hermes/export).
 *
 * GET ?status=pending — draft read path (Phase 9 —
 *   docs/telegram-approval-bridge.md §2 N2). Returns the pending-review drafts
 *   with enough to render a Telegram message: [{ pageId, platform, title, body,
 *   humanizer, createdBy, createdAt }] across the 4 content DBs. Read-only.
 *   Needed because `export` only gives a COUNT of pending drafts, and draft
 *   bodies are otherwise only on the session-authed /api/queue lane which the
 *   headless bridge worker cannot call. Degrades per-platform like export: an
 *   unconfigured / not-yet-migrated content DB is skipped, never failing the
 *   whole call. `?status` only supports "pending" in v1.
 */

import { NextRequest, NextResponse } from "next/server";
import { isMachineAuthorized } from "@/lib/machine-auth";
import { createDraft, DraftInputError, listPendingDrafts, parseDraftInput } from "@/lib/items";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isMachineAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const status = new URL(req.url).searchParams.get("status") ?? "pending";
    if (status !== "pending") {
      return NextResponse.json(
        { error: `Unsupported status "${status}" — only "pending" is supported in v1` },
        { status: 400 }
      );
    }

    // Derivation shared with /api/agent/drafts (lib/items.ts listPendingDrafts).
    const { drafts, warnings } = await listPendingDrafts();
    for (const w of warnings) console.warn(`GET /api/hermes/drafts: ${w}`);
    return NextResponse.json(drafts);
  } catch (err) {
    console.error("GET /api/hermes/drafts failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Draft list failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isMachineAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }

    const result = await createDraft(parseDraftInput(body as Record<string, unknown>));

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
