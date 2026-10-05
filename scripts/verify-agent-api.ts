/**
 * Verification for the Agent API lane (/api/agent/* — docs/AGENT-API.md). Run
 * against a RUNNING server (dev: `npm run dev -- -p 3001`):
 *
 *   npm run verify:agent-api                  # keyless checks only
 *   npm run verify:agent-api -- --live        # + authenticated read/write checks
 *   BASE_URL=https://isaac-twin-command-center.vercel.app npm run verify:agent-api -- --live
 *
 * BASE_URL defaults to http://localhost:3001 (`--url <base>` also works).
 *
 * Keyless (no token needed; the tokens in .env are only used to prove the two
 * machine lanes are NOT interchangeable, and are never printed):
 *   - every endpoint 401s with no Authorization header, with a wrong Bearer
 *     token, and with an empty Bearer; 401 bodies carry `error`
 *   - HERMES_API_TOKEN (if set) is rejected on /api/agent/*, and
 *     AGENT_API_TOKEN (if set) is rejected on /api/hermes/export
 *   - wrong HTTP method → 405 JSON (not 404 / not 401-leaking)
 *   - the session lane is still gated (GET /api/queue without a cookie → 401)
 *
 * --live (needs AGENT_API_TOKEN in .env, and the SAME token on the target
 * server): read endpoints, then ONE throwaway "ZZTEST" draft goes
 * create → edit → REJECT (with a reason) and the state is re-read. It NEVER
 * approves anything — approved items are picked up by the real publisher cron.
 * Edit / reject-with-reason auto-generate pending amendments; the script
 * rejects those (via the API) so nothing is left pending. It does NOT archive
 * anything: it prints the throwaway page id (and any amendment ids) at the end
 * for the operator to archive in Notion.
 *
 * Exit codes: 0 all PASS · 1 any FAIL · 2 --live requested but AGENT_API_TOKEN unset.
 */

import "dotenv/config";

let failures = 0;
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const LIVE = process.argv.includes("--live");
const BASE = (argValue("--url") ?? process.env.BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const DUMMY_ID = "00000000-0000-4000-8000-000000000000";
const MARKER = "ZZTEST";

interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  allow: string | null;
}

async function call(method: string, path: string, opts: { token?: string; auth?: string; json?: unknown; raw?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.auth !== undefined) headers.Authorization = opts.auth;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.raw !== undefined) {
    headers["Content-Type"] = "application/json";
    body = opts.raw;
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body, redirect: "manual" });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed, allow: res.headers.get("allow") };
}

const ENDPOINTS: [string, string][] = [
  ["GET", "/api/agent/state"],
  ["GET", "/api/agent/drafts"],
  ["POST", "/api/agent/drafts"],
  ["GET", "/api/agent/kpis"],
  ["GET", "/api/agent/proposals"],
  ["POST", `/api/agent/proposals/${DUMMY_ID}/accept`],
  ["POST", `/api/agent/proposals/${DUMMY_ID}/reject`],
  ["POST", `/api/agent/items/${DUMMY_ID}/approve`],
  ["POST", `/api/agent/items/${DUMMY_ID}/reject`],
  ["POST", `/api/agent/items/${DUMMY_ID}/edit`],
  ["POST", `/api/agent/items/${DUMMY_ID}/mark-posted`],
  ["POST", `/api/agent/items/${DUMMY_ID}/publish-next`],
];

async function keyless() {
  console.log("Keyless auth (every endpoint):");
  for (const [method, path] of ENDPOINTS) {
    const none = await call(method, path, { json: method === "POST" ? {} : undefined });
    assert(`${method} ${path.replace(DUMMY_ID, "<id>")} — no header → 401`, none.status === 401);
    assert("  401 body has error", typeof none.body?.error === "string");
    const wrong = await call(method, path, { token: "not-the-real-token", json: method === "POST" ? {} : undefined });
    assert("  wrong Bearer → 401", wrong.status === 401);
    const empty = await call(method, path, { auth: "Bearer ", json: method === "POST" ? {} : undefined });
    assert("  empty Bearer → 401", empty.status === 401);
  }

  console.log("\nLane separation:");
  const hermes = process.env.HERMES_API_TOKEN;
  const agent = process.env.AGENT_API_TOKEN;
  if (hermes && hermes !== agent) {
    const r = await call("GET", "/api/agent/state", { token: hermes });
    assert("HERMES_API_TOKEN rejected on /api/agent/state → 401", r.status === 401);
  } else {
    console.log("  skip — HERMES_API_TOKEN unset (or identical to AGENT_API_TOKEN, which would defeat separate revocation)");
    if (hermes && hermes === agent) assert("AGENT_API_TOKEN differs from HERMES_API_TOKEN", false);
  }
  if (agent && hermes !== agent) {
    const r = await call("GET", "/api/hermes/export", { token: agent });
    assert("AGENT_API_TOKEN rejected on /api/hermes/export → 401", r.status === 401);
  } else if (!agent) {
    console.log("  skip — AGENT_API_TOKEN unset in this environment");
  }
  const session = await call("GET", "/api/queue");
  assert("session lane still gated: GET /api/queue without cookie → 401", session.status === 401);

  console.log("\nMethod guards:");
  const del = await call("DELETE", "/api/agent/state");
  assert("DELETE /api/agent/state → 405 with Allow: GET", del.status === 405 && (del.allow ?? "").includes("GET"));
  assert("  405 body has error", typeof del.body?.error === "string");
  const get = await call("GET", `/api/agent/items/${DUMMY_ID}/approve`);
  assert("GET /api/agent/items/<id>/approve → 405 with Allow: POST", get.status === 405 && (get.allow ?? "").includes("POST"));
  const put = await call("PUT", "/api/agent/drafts");
  assert("PUT /api/agent/drafts → 405", put.status === 405);
}

async function live(token: string) {
  console.log("\nLive read endpoints:");
  const state = await call("GET", "/api/agent/state", { token });
  assert("GET state → 200, version 1", state.status === 200 && state.body?.version === 1);
  const sb = state.body ?? {};
  assert("state.drafts is array", Array.isArray(sb.drafts));
  assert(
    "state.lanes has approved/queued/posted/manual/rejected arrays",
    ["approved", "queued", "posted", "manual", "rejected"].every((k) => Array.isArray(sb.lanes?.[k]))
  );
  assert("state.publisher has mode/autoPlatforms/failures24h", ["typefully", "manual"].includes(sb.publisher?.mode) && Array.isArray(sb.publisher?.autoPlatforms) && typeof sb.publisher?.failures24h === "number");
  assert("state.proposals.pending is number", typeof sb.proposals?.pending === "number");
  assert("state.warnings is array", Array.isArray(sb.warnings));
  assert("state leaks no token-ish keys", !/token|secret|apikey|api_key|password|passphrase/i.test(Object.keys(flatten(sb)).join(" ")));

  const drafts = await call("GET", "/api/agent/drafts", { token });
  assert("GET drafts → 200, version 1, drafts[]", drafts.status === 200 && drafts.body?.version === 1 && Array.isArray(drafts.body?.drafts));
  const d0 = drafts.body?.drafts?.[0];
  if (d0) assert("draft has id/platform/title/body/createdAt", ["id", "platform", "title", "body", "createdAt"].every((k) => typeof d0[k] === "string"));
  console.log(`  info — ${drafts.body?.drafts?.length ?? "?"} pending draft(s) currently in the queue (untouched)`);

  const kpis = await call("GET", "/api/agent/kpis?window=7", { token });
  assert("GET kpis → 200, version 1, windowDays 7", kpis.status === 200 && kpis.body?.version === 1 && kpis.body?.windowDays === 7);
  const props = await call("GET", "/api/agent/proposals?limit=1", { token });
  assert("GET proposals → 200, proposals[]", props.status === 200 && Array.isArray(props.body?.proposals));
  const badStatus = await call("GET", "/api/agent/proposals?status=bogus", { token });
  assert("GET proposals?status=bogus → 400", badStatus.status === 400);

  console.log("\nInput validation:");
  const badPlatform = await call("POST", "/api/agent/drafts", { token, json: { platform: "myspace", title: "t", body: "b" } });
  assert("create draft, unknown platform → 400", badPlatform.status === 400);
  const badJson = await call("POST", "/api/agent/drafts", { token, raw: "{not json" });
  assert("create draft, malformed JSON → 400", badJson.status === 400);
  const badId = await call("POST", "/api/agent/items/not-a-uuid/approve", { token });
  assert("approve with non-UUID pageId → 400", badId.status === 400);
  const missing = await call("POST", `/api/agent/items/${DUMMY_ID}/reject`, { token, json: {} });
  assert("reject unknown (well-formed) pageId → 404", missing.status === 404);

  console.log(`\nThrowaway ${MARKER} draft lifecycle (create → edit → reject; NEVER approve):`);
  const created = await call("POST", "/api/agent/drafts", {
    token,
    json: {
      platform: "x",
      title: `${MARKER} agent-api verify — safe to delete`,
      body: `${MARKER} throwaway draft created by scripts/verify-agent-api.ts.\n\nIt is rejected by the same script and can be archived.`,
      sourceWorkflow: "verify-agent-api.ts",
    },
  });
  assert("create draft → 201, version 1", created.status === 201 && created.body?.version === 1);
  const id: string | undefined = created.body?.id;
  assert("create returns id + status Draft + warnings[]", typeof id === "string" && created.body?.status === "Draft" && Array.isArray(created.body?.warnings));
  if (!id) {
    console.log("  cannot continue the lifecycle without a page id");
    return;
  }
  console.log(`  info — throwaway page id: ${id}`);

  const listed = await call("GET", "/api/agent/drafts", { token });
  const found = (listed.body?.drafts ?? []).find((d: { id: string }) => d.id === id);
  assert("new draft appears in GET drafts with its body", !!found && String(found.body).includes(MARKER));

  const editedText = `${MARKER} EDITED by verify-agent-api.ts — still a throwaway.`;
  const edit = await call("POST", `/api/agent/items/${id}/edit`, { token, json: { text: editedText } });
  assert("edit → 200, status Draft, body echoed", edit.status === 200 && edit.body?.status === "Draft" && edit.body?.body === editedText && edit.body?.noop === false);
  const editEmpty = await call("POST", `/api/agent/items/${id}/edit`, { token, json: { text: "   " } });
  assert("edit with blank text → 400", editEmpty.status === 400);
  const editMissing = await call("POST", `/api/agent/items/${id}/edit`, { token, json: {} });
  assert("edit with no text field → 400", editMissing.status === 400);
  const afterEdit = await call("GET", "/api/agent/drafts", { token });
  const foundEdited = (afterEdit.body?.drafts ?? []).find((d: { id: string }) => d.id === id);
  assert("edited body is what GET drafts now returns", !!foundEdited && String(foundEdited.body).includes("EDITED"));

  const reject = await call("POST", `/api/agent/items/${id}/reject`, { token, json: { reason: `${MARKER} verify run — not a real rejection reason.` } });
  assert("reject → 200, status Rejected, noop false", reject.status === 200 && reject.body?.status === "Rejected" && reject.body?.noop === false);

  const state2 = await call("GET", "/api/agent/state", { token });
  assert("state: draft no longer pending", !(state2.body?.drafts ?? []).some((d: { id: string }) => d.id === id));
  assert("state: draft appears in lanes.rejected", (state2.body?.lanes?.rejected ?? []).some((i: { id: string }) => i.id === id));

  console.log("\nReplay / conflict semantics on the rejected item:");
  const rejectAgain = await call("POST", `/api/agent/items/${id}/reject`, { token, json: {} });
  assert("reject again → 200 noop (already-decided), status Rejected", rejectAgain.status === 200 && rejectAgain.body?.noop === true && rejectAgain.body?.status === "Rejected");
  const approveRejected = await call("POST", `/api/agent/items/${id}/approve`, { token });
  assert("approve on a Rejected item → 200 noop, status stays Rejected (NOT approved)", approveRejected.status === 200 && approveRejected.body?.noop === true && approveRejected.body?.status === "Rejected");
  const editRejected = await call("POST", `/api/agent/items/${id}/edit`, { token, json: { text: "should not apply" } });
  assert("edit on a Rejected item → 409 (not a silent no-op)", editRejected.status === 409);
  const markRejected = await call("POST", `/api/agent/items/${id}/mark-posted`, { token });
  assert("mark-posted on a Rejected item → 409", markRejected.status === 409);
  const publishRejected = await call("POST", `/api/agent/items/${id}/publish-next`, { token });
  assert("publish-next on a non-Approved item → 409 (nothing publishes without approve)", publishRejected.status === 409);

  console.log("\nCleanup of auto-generated amendments:");
  const pending = await call("GET", "/api/agent/proposals?status=pending&limit=100", { token });
  const ours = (pending.body?.proposals ?? []).filter((p: { topic?: string; evidenceSummary?: string; proposedPositionText?: string }) =>
    `${p.topic} ${p.evidenceSummary} ${p.proposedPositionText}`.includes(MARKER)
  );
  console.log(`  info — ${ours.length} pending ${MARKER} amendment(s) found`);
  const amendmentIds: string[] = [];
  for (const p of ours as { id: string }[]) {
    const r = await call("POST", `/api/agent/proposals/${p.id}/reject`, { token });
    assert(`reject amendment ${p.id} → 200, status rejected`, r.status === 200 && r.body?.status === "rejected" && r.body?.noop === false);
    const again = await call("POST", `/api/agent/proposals/${p.id}/reject`, { token });
    assert("  reject again → 200 noop", again.status === 200 && again.body?.noop === true);
    const wrongWay = await call("POST", `/api/agent/proposals/${p.id}/accept`, { token });
    assert("  accept a rejected amendment → 409", wrongWay.status === 409);
    amendmentIds.push(p.id);
  }

  console.log("\nLeft behind for the operator to archive in Notion:");
  console.log(`  content page (Rejected): ${id}`);
  for (const a of amendmentIds) console.log(`  amendment page (rejected):  ${a}`);
  console.log(`  (Calibration Events rows with Object ID ${id} and Source=agent also exist — logs, harmless)`);
}

// Flatten an object's keys (recursively) so the token-ish scan covers nested keys too.
function flatten(o: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      out[k] = true;
      flatten(v, out);
    }
  }
  return out;
}

async function main() {
  console.log(`Verifying Agent API at ${BASE}${LIVE ? " (--live)" : " (keyless)"}\n`);
  const token = process.env.AGENT_API_TOKEN;
  if (LIVE && !token) {
    console.log("--live needs AGENT_API_TOKEN in .env (and the same token on the target server)");
    process.exit(2);
  }
  try {
    await keyless();
    if (LIVE && token) await live(token);
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    console.log(`  FAIL — request error: ${err instanceof Error ? err.message : err}${cause ? ` (${cause})` : ""} — is the server running at ${BASE}?`);
    failures++;
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
