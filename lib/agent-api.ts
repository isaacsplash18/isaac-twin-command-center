/**
 * Shared plumbing for the Agent API lane (/api/agent/* — docs/AGENT-API.md).
 *
 * Auth is Bearer AGENT_API_TOKEN (lib/machine-auth.ts isAgentAuthorized), fails
 * closed when unset, and is separate from the Hermes lane. Every success body
 * carries `version: 1` (the hermes export convention — a breaking change bumps
 * it); every failure is `{ error }` at the right status, like handleAction.
 *
 * Business logic stays in lib/actions, lib/items, lib/publisher, lib/proposals,
 * lib/kpis — routes here only authenticate, parse, and map HTTP statuses.
 */

import { NextRequest, NextResponse } from "next/server";
import { ActionError } from "./actions";
import { isAgentAuthorized } from "./machine-auth";
import { DraftInputError } from "./items";
import { getPage, readStatus } from "./notion";

export const AGENT_API_VERSION = 1;

export function agentJson(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ version: AGENT_API_VERSION, ...body }, { status });
}

export function agentError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** 405 handler for a verb a route doesn't implement (Next's built-in 405 has an empty body). */
export function methodNotAllowed(allow: string) {
  return async () =>
    NextResponse.json({ error: `Method not allowed — use ${allow}` }, { status: 405, headers: { Allow: allow } });
}

/** Auth gate + the per-route try/catch/status mapping. Never logs the token or header. */
export async function agentRoute(
  req: NextRequest,
  label: string,
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  if (!isAgentAuthorized(req)) return agentError("Unauthorised", 401);
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ActionError || err instanceof DraftInputError) {
      return agentError(err.message, err.status);
    }
    const message = err instanceof Error ? err.message : "Request failed";
    // A page/proposal id that doesn't exist in Notion — report 404, not a 500.
    if (/^Notion 404 /.test(message)) return agentError("Not found", 404);
    console.error(`${label} failed:`, err);
    return agentError(message, 500);
  }
}

const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export function assertNotionId(id: string, what = "pageId"): string {
  if (!NOTION_ID.test(id)) throw new ActionError(`${what} must be a Notion page id (UUID)`, 400);
  return id;
}

/** Parse an optional JSON object body: empty ⇒ {}, malformed/non-object ⇒ 400. */
export async function readJsonBody(req: NextRequest, required: boolean): Promise<Record<string, unknown>> {
  const raw = (await req.text()).trim();
  if (!raw) {
    if (required) throw new ActionError("Request body must be JSON", 400);
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ActionError("Request body must be JSON", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ActionError("Request body must be a JSON object", 400);
  }
  return parsed as Record<string, unknown>;
}

async function statusOf(pageId: string): Promise<string | null> {
  try {
    return readStatus(await getPage(pageId));
  } catch {
    return null; // best-effort — report null rather than failing the no-op
  }
}

/**
 * Run a state-changing item action with replay semantics. A 409 from the
 * wrapped lib action means "the item already moved on"; when `isReplay(status)`
 * (judged on a fresh re-read) that is a SUCCESS no-op — `200 { noop: true }` —
 * so re-POSTing the same request is safe. Otherwise the 409 passes through.
 * Default `isReplay` accepts any status: the /api/hermes/decisions convention,
 * where the caller reads `status` to see what the item actually became.
 */
export async function itemAction(
  id: string,
  action: string,
  run: () => Promise<Record<string, unknown>>,
  replay: { isReplay?: (status: string | null) => boolean; note?: (status: string | null) => string } = {}
): Promise<NextResponse> {
  try {
    return agentJson({ ok: true, id, action, noop: false, ...(await run()) });
  } catch (err) {
    if (err instanceof ActionError && err.status === 409) {
      const status = await statusOf(id);
      if ((replay.isReplay ?? (() => true))(status)) {
        return agentJson({
          ok: true,
          id,
          action,
          status,
          noop: true,
          note: replay.note ? replay.note(status) : "already-decided",
        });
      }
    }
    throw err;
  }
}
