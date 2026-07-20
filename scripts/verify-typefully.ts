/**
 * Verification for X-only Typefully auto-publishing gating. Run with:
 *
 *   npx tsx scripts/verify-typefully.ts
 *   npx tsx scripts/verify-typefully.ts --live
 *   (or: npm run verify:typefully -- --live)
 *
 * Always runs (no server, no key needed):
 *   - prints the resolved publish mode + per-platform autoPublish flags for
 *     the current process env.
 *   - asserts the gating formula (TYPEFULLY_ENABLED && TYPEFULLY_PLATFORMS.has(key))
 *     against a handful of TYPEFULLY_PLATFORMS-parsing cases via the pure
 *     `parseTypefullyPlatforms` helper, including "no key -> everything manual".
 *
 * Live section (only with TYPEFULLY_API_KEY set AND --live):
 *   - lists social sets (id + name only, never the key),
 *   - creates a real scheduled draft on X, ~1 year out, body "TWIN CC
 *     verification draft — safe to delete" (never `publish_at: "now"`),
 *   - fetches its state,
 *   - deletes it (try/finally — runs even if the state fetch throws).
 *
 * No key, or no --live: live section is skipped with a clear message; the
 * script still exits 0 (same convention as the other verify-*.ts scripts).
 */

import "dotenv/config";
import { PLATFORMS, TYPEFULLY_ENABLED, parseTypefullyPlatforms } from "../lib/config";
import { createScheduledDraft, deleteDraft, getDraftState, listSocialSets } from "../lib/typefully";

let failures = 0;
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

function setEquals(a: Set<string>, b: string[]): boolean {
  return a.size === b.length && b.every((v) => a.has(v));
}

async function main() {
  console.log("Resolved publish mode (current env):");
  console.log(`  mode: ${TYPEFULLY_ENABLED ? "typefully" : "manual"}`);
  for (const p of PLATFORMS) {
    console.log(`  ${p.key}: autoPublish=${p.autoPublish}`);
  }

  console.log("\nTYPEFULLY_PLATFORMS parsing (pure helper, no env mutation):");
  assert('unset -> default {"x"}', setEquals(parseTypefullyPlatforms(undefined), ["x"]));
  assert('"" -> default {"x"}', setEquals(parseTypefullyPlatforms(""), ["x"]));
  assert('"x" -> {"x"}', setEquals(parseTypefullyPlatforms("x"), ["x"]));
  assert('"linkedin" -> {"linkedin"}', setEquals(parseTypefullyPlatforms("linkedin"), ["linkedin"]));
  assert('"x,linkedin" -> {"x","linkedin"}', setEquals(parseTypefullyPlatforms("x,linkedin"), ["x", "linkedin"]));
  assert('"X, LinkedIn" (case/whitespace) -> {"x","linkedin"}', setEquals(parseTypefullyPlatforms("X, LinkedIn"), ["x", "linkedin"]));

  console.log("\nGating formula (autoPublish = TYPEFULLY_ENABLED && TYPEFULLY_PLATFORMS.has(key)):");
  const gate = (enabled: boolean, raw: string | undefined, key: string) => enabled && parseTypefullyPlatforms(raw).has(key);
  assert("no key (enabled=false), default platforms -> x manual", gate(false, undefined, "x") === false);
  assert("no key (enabled=false), default platforms -> linkedin manual", gate(false, undefined, "linkedin") === false);
  assert("no key (enabled=false), TYPEFULLY_PLATFORMS=x,linkedin -> still all manual", gate(false, "x,linkedin", "linkedin") === false);
  assert("key set, default platforms -> x auto", gate(true, undefined, "x") === true);
  assert("key set, default platforms -> linkedin stays manual", gate(true, undefined, "linkedin") === false);
  assert("key set, TYPEFULLY_PLATFORMS=linkedin -> x manual", gate(true, "linkedin", "x") === false);
  assert("key set, TYPEFULLY_PLATFORMS=linkedin -> linkedin auto", gate(true, "linkedin", "linkedin") === true);
  assert("key set, TYPEFULLY_PLATFORMS=x,linkedin -> both auto", gate(true, "x,linkedin", "x") === true && gate(true, "x,linkedin", "linkedin") === true);

  if (!process.env.TYPEFULLY_API_KEY) {
    assert("current env has no TYPEFULLY_API_KEY -> TYPEFULLY_ENABLED is false", TYPEFULLY_ENABLED === false);
    assert("current env has no TYPEFULLY_API_KEY -> every platform manual", PLATFORMS.every((p) => !p.autoPublish));
  }

  const live = process.argv.includes("--live");
  if (!process.env.TYPEFULLY_API_KEY) {
    console.log("\nLive section skipped — TYPEFULLY_API_KEY is unset.");
  } else if (!live) {
    console.log("\nLive section skipped — pass --live to exercise the real Typefully API.");
  } else {
    console.log("\nLive section (real Typefully API calls):");

    console.log("  Listing social sets...");
    const sets = await listSocialSets();
    for (const s of sets) console.log(`    ${s.id}  ${s.name}`);
    assert("at least one social set on the account", sets.length > 0);

    const publishAtIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    console.log(`  Creating a scheduled X draft for ${publishAtIso} (never "now")...`);
    const draft = await createScheduledDraft({
      platform: "x",
      body: "TWIN CC verification draft — safe to delete",
      publishAtIso,
    });
    console.log(`    created draft ${draft.id}`);

    try {
      console.log("  Fetching draft state...");
      const state = await getDraftState(draft.id);
      console.log(`    status=${state.status} publishedUrl=${state.publishedUrl ?? "-"}`);
      assert("status is not published (draft was just created, scheduled ~1 year out)", state.status !== "published");
    } finally {
      console.log("  Deleting draft...");
      await deleteDraft(draft.id);
      console.log("    deleted");
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
