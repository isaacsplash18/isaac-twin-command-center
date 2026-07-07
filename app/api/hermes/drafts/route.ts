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
import { PLATFORMS } from "@/lib/config";
import { createDraft, DraftInputError, itemsWithStatus } from "@/lib/items";
import { getPage, readSelectProp } from "@/lib/notion";

export const dynamic = "force-dynamic";

interface PendingDraft {
  pageId: string;
  platform: string;
  title: string;
  body: string;
  humanizer: string;
  createdBy: string;
  createdAt: string;
}

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

    const drafts: PendingDraft[] = [];
    // Each platform lane degrades independently — an unconfigured or
    // not-yet-migrated DS is skipped (logged), never failing the whole call.
    await Promise.all(
      PLATFORMS.map(async (p) => {
        if (!process.env[p.dsEnv]) {
          console.warn(`GET /api/hermes/drafts: ${p.dsEnv} not configured — ${p.label} skipped`);
          return;
        }
        try {
          const items = await itemsWithStatus(p, "Draft", { withBody: true, limit: 100 });
          for (const item of items) {
            // Humanizer / Created By are additive provenance props (Phase 7) not
            // carried on ContentItem — read them off the page. readSelectProp
            // returns "" when the prop is absent (pre-migration), never throws.
            let humanizer = "";
            let createdBy = "";
            try {
              const page = await getPage(item.id);
              humanizer = readSelectProp(page, "Humanizer") ?? "";
              createdBy = readSelectProp(page, "Created By") ?? "";
            } catch {
              // Provenance is optional — a read failure here must not drop the draft.
            }
            drafts.push({
              pageId: item.id,
              platform: item.platform,
              title: item.title,
              body: item.body,
              humanizer,
              createdBy,
              createdAt: item.createdTime,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Missing select option = schema not migrated yet; not a hard failure.
          if (!message.includes("not found for property")) {
            console.warn(`GET /api/hermes/drafts: ${p.label} draft list failed: ${message}`);
          }
        }
      })
    );

    // Newest first across all platforms (Notion created_time descending).
    drafts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

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
