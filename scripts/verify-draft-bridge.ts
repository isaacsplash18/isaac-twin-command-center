/**
 * Verification for the draft creation bridge (Phase 7). Run with:
 *
 *   npx tsx scripts/verify-draft-bridge.ts
 *   npx tsx scripts/verify-draft-bridge.ts --url http://localhost:3100
 *   (or: npm run verify:draft-bridge -- --url http://localhost:3100)
 *
 * If HERMES_API_TOKEN is unset, prints "machine lane disabled — set
 * HERMES_API_TOKEN" and exits 0 — same convention as
 * verify-hermes-export.ts / verify-proposals.ts / verify-calibration-events.ts.
 *
 * Otherwise:
 *   (a) POST without an Authorization header → asserts 401.
 *   (b) POST with a valid token but an unknown platform → asserts 400.
 *   (c) POST a valid X draft titled "VERIFY-DRAFT-BRIDGE — safe to delete" →
 *       asserts 201 + a page id, then reads the created page back via
 *       lib/notion and asserts Status is Draft, the title matches, and the
 *       two-paragraph body round-trips exactly.
 *   (d) archives the test page (cleanup) — never leaves a stray draft behind.
 *
 * This script creates exactly one throwaway Notion page and archives it
 * before exiting; it never touches any real draft.
 */

import "dotenv/config";
import { getPage, notionFetch, readBody, readStatus, readTitle } from "../lib/notion";

let failures = 0;
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const token = process.env.HERMES_API_TOKEN;
  if (!token) {
    console.log("machine lane disabled — set HERMES_API_TOKEN");
    process.exit(0);
  }

  const baseUrl = argValue("--url") ?? "http://localhost:3000";
  const url = `${baseUrl.replace(/\/$/, "")}/api/hermes/drafts`;
  console.log(`Verifying draft creation bridge at ${url}\n`);

  // --- (a) no Authorization header → 401 -------------------------------------
  console.log("Unauthenticated request:");
  const unauth = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform: "x", title: "t", body: "b" }),
  });
  assert("no Authorization header → 401", unauth.status === 401);

  const wrongAuth = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer not-the-real-token" },
    body: JSON.stringify({ platform: "x", title: "t", body: "b" }),
  });
  assert("wrong Bearer token → 401", wrongAuth.status === 401);

  // --- (b) valid token, bad platform → 400 ------------------------------------
  console.log("\nBad platform request:");
  const badPlatform = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform: "not-a-real-platform", title: "t", body: "b" }),
  });
  assert("unknown platform → 400", badPlatform.status === 400);
  const badPlatformBody = await badPlatform.json().catch(() => null);
  assert(
    "400 body has an error field",
    !!badPlatformBody && typeof badPlatformBody === "object" && typeof badPlatformBody.error === "string"
  );

  const emptyTitle = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ platform: "x", title: "  ", body: "b" }),
  });
  assert("empty title → 400", emptyTitle.status === 400);

  // --- (c) valid X draft → 201 + Notion round-trip ----------------------------
  console.log("\nValid X draft creation:");
  const title = "VERIFY-DRAFT-BRIDGE — safe to delete";
  const bodyText =
    "First paragraph of the verification draft, written by scripts/verify-draft-bridge.ts.\n\n" +
    "Second paragraph of the verification draft — this page is archived automatically at the end of the run.";

  const createRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      platform: "x",
      title,
      body: bodyText,
      sourceWorkflow: "verify-draft-bridge.ts",
      humanizerStatus: "unknown",
      createdBy: "hermes",
    }),
  });
  assert("valid draft → 201", createRes.status === 201);

  if (createRes.status !== 201) {
    const errBody = await createRes.text().catch(() => "");
    console.log(`  response body: ${errBody.slice(0, 500)}`);
    console.log(`\n${failures} FAILURE(S)`);
    process.exit(1);
  }

  const created = await createRes.json();
  assert("response has id", typeof created.id === "string" && created.id.length > 0);
  assert("response has url", typeof created.url === "string" && created.url.length > 0);
  assert("response platform is x", created.platform === "x");
  assert("response status is Draft", created.status === "Draft");
  assert("response warnings is array", Array.isArray(created.warnings));
  if (Array.isArray(created.warnings) && created.warnings.length > 0) {
    console.log(`  note: warnings present — ${created.warnings.join("; ")}`);
    console.log("  (this is expected pre-migration; run `npm run migrate` to clear it)");
  }

  // Track the created page so it is archived even if an assertion or network
  // call below throws midway (mirrors verify-telegram-decisions.ts) — a stray
  // Status:Draft X page would otherwise surface in the real approval queue.
  const createdId: string | null = typeof created.id === "string" && created.id ? created.id : null;
  try {
    console.log("\nNotion round-trip:");
    if (createdId) {
      const page = await getPage(createdId);
      assert("Notion Status is Draft", readStatus(page) === "Draft");
      assert("Notion title matches", readTitle(page) === title);
      const roundTrippedBody = await readBody(createdId);
      assert("Notion body paragraphs round-trip", roundTrippedBody === bodyText);
    } else {
      console.log("  (skipped — no page id returned)");
    }
  } finally {
    if (createdId) {
      console.log("\nCleanup:");
      try {
        await notionFetch(`/pages/${createdId}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
        console.log(`  archived test page ${createdId}`);
      } catch (err) {
        console.log(`  WARN — could not archive ${createdId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
