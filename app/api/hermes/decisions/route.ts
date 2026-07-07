/**
 * POST /api/hermes/decisions — Telegram approval bridge write-back (Phase 9 —
 * docs/telegram-approval-bridge.md §2 N1). Machine lane only: authenticated via
 * `Authorization: Bearer ${HERMES_API_TOKEN}` (lib/machine-auth.ts), NOT the
 * human session cookie. Self-authenticates — `/api/hermes/` is already in
 * middleware.ts's PUBLIC_PREFIXES (Phase 5), no middleware change needed here.
 *
 * Wraps the same lib/actions.ts lifecycle actions the web UI uses
 * (approveItem / rejectItem / editItem), tagged `source: "telegram"` on the
 * resulting CalibrationEvent. This route NEVER publishes — it only flips
 * Draft → Approved / Rejected, exactly like a click in the approval queue.
 *
 * Idempotency is status-based (design §2, O5): approveItem/rejectItem/editItem
 * throw ActionError(409) when the page has already moved off Draft. For the
 * bridge, "someone already decided this" (a duplicate Telegram reply, or Isaac
 * decided in the web UI first) is a SUCCESS, not a failure — so a 409 from the
 * wrapped action is translated into `200 { noop: true, note: "already-decided" }`.
 * This makes re-POSTing the same decision replay-safe. All other errors pass
 * through unchanged (400 bad body, 500 unexpected), mirroring handleAction.
 */

import { NextRequest, NextResponse } from "next/server";
import { isMachineAuthorized } from "@/lib/machine-auth";
import { ActionError, approveItem, editItem, rejectItem } from "@/lib/actions";
import { CalibrationSource } from "@/lib/calibration-events";
import { getPage, readStatus } from "@/lib/notion";

export const dynamic = "force-dynamic";

type DecisionAction = "approve" | "reject" | "edit";

const VALID_SOURCES: CalibrationSource[] = ["command_center", "telegram", "hermes"];

export async function POST(req: NextRequest) {
  if (!isMachineAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  // --- Validation (400) ------------------------------------------------------
  const pageId = typeof b.pageId === "string" ? b.pageId.trim() : "";
  if (!pageId) {
    return NextResponse.json({ error: "pageId is required" }, { status: 400 });
  }

  const action = b.action;
  if (action !== "approve" && action !== "reject" && action !== "edit") {
    return NextResponse.json(
      { error: 'action must be one of "approve", "reject", "edit"' },
      { status: 400 }
    );
  }

  const editedText = typeof b.editedText === "string" ? b.editedText : undefined;
  if (action === "edit" && (!editedText || !editedText.trim())) {
    return NextResponse.json({ error: "editedText is required for action \"edit\"" }, { status: 400 });
  }

  const reason = typeof b.reason === "string" ? b.reason : undefined;
  // The write-back defaults to "telegram" (this is the Telegram bridge lane);
  // an explicit, valid `source` in the body overrides it. Anything else falls
  // back to "telegram" rather than erroring — source is a log tag, not authz.
  const source: CalibrationSource = VALID_SOURCES.includes(b.source as CalibrationSource)
    ? (b.source as CalibrationSource)
    : "telegram";
  const idempotencyKey = typeof b.idempotencyKey === "string" ? b.idempotencyKey : undefined;

  const echoKey = idempotencyKey ? { idempotencyKey } : {};

  try {
    let status: string | null;
    if (action === "approve") {
      const item = await approveItem(pageId, source);
      status = item.status;
    } else if (action === "reject") {
      await rejectItem(pageId, source, reason);
      status = "Rejected";
    } else {
      // EDIT resolves to a single logical EDIT-APPROVE (design §5): edit the
      // body, then approve — one Telegram reply = one decision.
      await editItem(pageId, editedText!, source);
      const item = await approveItem(pageId, source);
      status = item.status;
    }

    return NextResponse.json({
      ok: true,
      pageId,
      action,
      status,
      noop: false,
      ...echoKey,
    });
  } catch (err) {
    // 409 → the item already moved off Draft. For the bridge that's a
    // successful no-op (duplicate/stale decision), not an error.
    if (err instanceof ActionError && err.status === 409) {
      let status: string | null = null;
      try {
        status = readStatus(await getPage(pageId));
      } catch {
        // Best-effort — report null status rather than failing the no-op.
      }
      return NextResponse.json({
        ok: true,
        pageId,
        action,
        status,
        noop: true,
        note: "already-decided",
        ...echoKey,
      });
    }
    // All other errors mirror the handleAction / export route catch path.
    if (err instanceof ActionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/hermes/decisions failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Decision failed" },
      { status: 500 }
    );
  }
}
