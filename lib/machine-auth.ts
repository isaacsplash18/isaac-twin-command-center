/**
 * Machine auth lane for Hermes (Phase 5 — docs/hermes-calibration-plan.md §4.3).
 *
 * Checks `Authorization: Bearer ${HERMES_API_TOKEN}` with a constant-time
 * comparison, mirroring the passphrase check in lib/auth.ts (same
 * timingSafeEqualStr helper, re-exported from there rather than duplicated).
 *
 * Returns false whenever HERMES_API_TOKEN is unset — the machine lane is
 * disabled by default, matching the CRON_SECRET convention in
 * app/api/cron/publish/route.ts. Never logs the token or the incoming header.
 */

import { NextRequest } from "next/server";
import { timingSafeEqualStr } from "./auth";

function bearerMatches(req: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return timingSafeEqualStr(auth, `Bearer ${secret}`);
}

export function isMachineAuthorized(req: NextRequest): boolean {
  return bearerMatches(req, process.env.HERMES_API_TOKEN);
}

/**
 * Agent API lane (/api/agent/* — docs/AGENT-API.md): same check against
 * AGENT_API_TOKEN. Deliberately a separate secret from HERMES_API_TOKEN so
 * each lane is revoked independently (unset one ⇒ only that lane 401s) and a
 * leaked Hermes token can't drive the agent endpoints or vice versa.
 */
export function isAgentAuthorized(req: NextRequest): boolean {
  return bearerMatches(req, process.env.AGENT_API_TOKEN);
}
