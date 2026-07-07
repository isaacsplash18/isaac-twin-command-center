/**
 * Verification for the Hermes-readable export (Phase 5). Run with:
 *
 *   npx tsx scripts/verify-hermes-export.ts
 *   npx tsx scripts/verify-hermes-export.ts --url http://localhost:3100
 *   (or: npm run verify:hermes-export -- --url http://localhost:3100)
 *
 * If HERMES_API_TOKEN is unset, prints "machine lane disabled — set
 * HERMES_API_TOKEN" and exits 0 — the app must keep working pre-configuration,
 * same convention as verify-calibration-events.ts / verify-proposals.ts.
 *
 * Otherwise:
 *   (a) requests the export WITHOUT the Authorization header → asserts 401.
 *   (b) requests it WITH the header → asserts 200, then structurally
 *       validates the response: every required key present with the right
 *       type, all timestamps parse, `events` sorted newest-first, and no key
 *       anywhere in the payload that looks like a credential
 *       (token/secret/apikey/password).
 *
 * This script only ever performs GET requests — it never writes anything.
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

function isIsoDate(v: unknown): boolean {
  return typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));
}

const SECRET_KEY_PATTERN = /token|secret|apikey|api_key|password|passphrase/i;

/** Recursively walk an object/array and collect any key name that looks like a credential. */
function findSuspiciousKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...findSuspiciousKeys(item, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) hits.push(`${path}.${key}`);
      hits.push(...findSuspiciousKeys(v, `${path}.${key}`));
    }
  }
  return hits;
}

interface CalibrationEventLike {
  id: unknown;
  createdAt: unknown;
  source: unknown;
  objectType: unknown;
  objectId: unknown;
  platform: unknown;
  topic: unknown;
  action: unknown;
  rawUserText: unknown;
  previousText: unknown;
  newText: unknown;
  affectedPositionIds: unknown;
  inferredDelta: unknown;
  status: unknown;
}

function validateEventShape(e: Partial<CalibrationEventLike>, label: string) {
  assert(`${label}: id is string`, typeof e.id === "string");
  assert(`${label}: createdAt is valid ISO`, isIsoDate(e.createdAt));
  assert(`${label}: source is string`, typeof e.source === "string");
  assert(`${label}: objectType is string`, typeof e.objectType === "string");
  assert(`${label}: objectId is string`, typeof e.objectId === "string");
  assert(`${label}: platform is string`, typeof e.platform === "string");
  assert(`${label}: topic is string`, typeof e.topic === "string");
  assert(`${label}: action is string`, typeof e.action === "string");
  assert(`${label}: rawUserText is string`, typeof e.rawUserText === "string");
  assert(`${label}: previousText is string`, typeof e.previousText === "string");
  assert(`${label}: newText is string`, typeof e.newText === "string");
  assert(`${label}: affectedPositionIds is array`, Array.isArray(e.affectedPositionIds));
  assert(`${label}: inferredDelta is string`, typeof e.inferredDelta === "string");
  assert(`${label}: status is string`, typeof e.status === "string");
}

function validateProposalShape(p: Record<string, unknown>, label: string) {
  assert(`${label}: id is string`, typeof p.id === "string");
  assert(`${label}: createdAt is valid ISO`, isIsoDate(p.createdAt));
  assert(`${label}: updatedAt is valid ISO`, isIsoDate(p.updatedAt));
  assert(`${label}: sourceEventIds is array`, Array.isArray(p.sourceEventIds));
  assert(`${label}: affectedPositionId is string`, typeof p.affectedPositionId === "string");
  assert(`${label}: topic is string`, typeof p.topic === "string");
  assert(`${label}: currentPositionText is string`, typeof p.currentPositionText === "string");
  assert(`${label}: proposedPositionText is string`, typeof p.proposedPositionText === "string");
  assert(`${label}: reason is string`, typeof p.reason === "string");
  assert(`${label}: evidenceSummary is string`, typeof p.evidenceSummary === "string");
  assert(`${label}: confidence is low/medium/high`, ["low", "medium", "high"].includes(p.confidence as string));
  assert(
    `${label}: status is pending/accepted/rejected/applied`,
    ["pending", "accepted", "rejected", "applied"].includes(p.status as string)
  );
}

async function main() {
  const token = process.env.HERMES_API_TOKEN;
  if (!token) {
    console.log("machine lane disabled — set HERMES_API_TOKEN");
    process.exit(0);
  }

  const baseUrl = argValue("--url") ?? "http://localhost:3000";
  const url = `${baseUrl.replace(/\/$/, "")}/api/hermes/export`;
  console.log(`Verifying Hermes export at ${url}\n`);

  // --- (a) no Authorization header → 401 ------------------------------------
  console.log("Unauthenticated request:");
  const unauth = await fetch(url);
  assert("no Authorization header → 401", unauth.status === 401);
  let unauthBody: unknown = null;
  try {
    unauthBody = await unauth.json();
  } catch {
    // ignore — body shape isn't asserted for the negative case
  }
  assert(
    "401 body has an error field",
    !!unauthBody && typeof unauthBody === "object" && typeof (unauthBody as Record<string, unknown>).error === "string"
  );

  // Also check a wrong-token request is rejected the same way.
  const wrongAuth = await fetch(url, { headers: { Authorization: "Bearer not-the-real-token" } });
  assert("wrong Bearer token → 401", wrongAuth.status === 401);

  // --- (b) correct Authorization header → 200 + schema -----------------------
  console.log("\nAuthenticated request:");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert("valid Bearer token → 200", res.status === 200);

  if (res.status !== 200) {
    console.log(`\n${failures} FAILURE(S)`);
    process.exit(1);
  }

  const body = await res.json();

  console.log("\nTop-level schema:");
  assert("version === 1", body.version === 1);
  assert("generatedAt is valid ISO", isIsoDate(body.generatedAt));
  assert("since is valid ISO", isIsoDate(body.since));
  assert("events is array", Array.isArray(body.events));
  assert("proposals is object", !!body.proposals && typeof body.proposals === "object");
  assert("proposals.pending is array", Array.isArray(body.proposals?.pending));
  assert("proposals.accepted is array", Array.isArray(body.proposals?.accepted));
  assert("drafts is object", !!body.drafts && typeof body.drafts === "object");
  assert("drafts.pendingReview is number", typeof body.drafts?.pendingReview === "number");
  assert("publisher is object", !!body.publisher && typeof body.publisher === "object");
  assert(
    "publisher.mode is manual/typefully",
    body.publisher?.mode === "manual" || body.publisher?.mode === "typefully"
  );
  assert("warnings is array", Array.isArray(body.warnings));
  assert("warnings entries are strings", (body.warnings ?? []).every((w: unknown) => typeof w === "string"));

  console.log("\nevents[] shape:");
  if (Array.isArray(body.events)) {
    body.events.slice(0, 5).forEach((e: CalibrationEventLike, i: number) => validateEventShape(e, `events[${i}]`));
    let sorted = true;
    for (let i = 1; i < body.events.length; i++) {
      const prev = Date.parse(body.events[i - 1].createdAt);
      const cur = Date.parse(body.events[i].createdAt);
      if (cur > prev) sorted = false;
    }
    assert("events sorted newest-first", sorted);
    if (body.events.length === 0) console.log("  (0 events — sort-order check trivially passes)");
  }

  console.log("\nproposals[] shape:");
  const pendingList = Array.isArray(body.proposals?.pending) ? body.proposals.pending : [];
  const acceptedList = Array.isArray(body.proposals?.accepted) ? body.proposals.accepted : [];
  pendingList.slice(0, 5).forEach((p: Record<string, unknown>, i: number) => validateProposalShape(p, `pending[${i}]`));
  acceptedList.slice(0, 5).forEach((p: Record<string, unknown>, i: number) => validateProposalShape(p, `accepted[${i}]`));
  if (pendingList.length === 0 && acceptedList.length === 0) {
    console.log("  (no proposals present — shape checks trivially pass)");
  }

  console.log("\nSecret-leak guard:");
  const suspicious = findSuspiciousKeys(body);
  assert("no token/secret/apikey/password-like keys in payload", suspicious.length === 0);
  if (suspicious.length > 0) console.log(`  found: ${suspicious.join(", ")}`);

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
