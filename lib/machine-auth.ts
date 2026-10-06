import { NextRequest } from "next/server";
import { timingSafeEqualStr } from "./auth";

function bearerMatches(req: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return timingSafeEqualStr(auth, `Bearer ${secret}`);
}

/** Authenticates external automation using the dedicated Agent API token. */
export function isAgentAuthorized(req: NextRequest): boolean {
  return bearerMatches(req, process.env.AGENT_API_TOKEN);
}
