/**
 * Verification for the Buffer publishing engine. Run with:
 *
 *   npx tsx scripts/verify-buffer.ts
 *   npx tsx scripts/verify-buffer.ts --live
 *   (or: npm run verify:buffer -- --live)
 *
 * Always runs (no server, no key, no network):
 *   - PUBLISH_ENGINE parsing (default "typefully", invalid → null / throws).
 *   - stored-id routing: un-prefixed → Typefully, "buffer:<id>" → Buffer, prefix
 *     stripped before the vendor call.
 *   - engine × env × platform gating matrix (computeAutoPublish / computeReconciles
 *     / computePublisherMode over a synthetic env object — process.env untouched),
 *     including "no Buffer env ⇒ identical to the old Typefully gating" and the
 *     PUBLISH_MODE=manual kill switch.
 *   - Buffer X-thread handling (pure): break marker → metadata.twitter.thread with
 *     top-level text == first item; empty segment → ActionError; LinkedIn/Substack
 *     stay single posts; status mapping sent → published.
 *
 * Live section (only with BUFFER_ACCESS_TOKEN set AND --live):
 *   - lists channels (id + service + name only — to fill BUFFER_CHANNEL_*),
 *   - creates a post scheduled ~1 year out on the X channel (BUFFER_CHANNEL_X,
 *     else the first twitter channel, else the first channel found) with body
 *     "ZZTEST Constitute engine verification — safe to delete" (never publishes now),
 *   - fetches its state,
 *   - deletes it (try/finally — runs even if the state fetch throws).
 *
 * No token, or no --live: live section skipped with a clear message; exit 0.
 */

import "dotenv/config";
import {
  PLATFORMS,
  computeAutoPublish,
  computePublisherMode,
  computeReconciles,
  parsePublishEngine,
} from "../lib/config";
import { buildCreatePostInput, listChannels, mapBufferStatus, xThreadTexts } from "../lib/buffer";
import { createScheduledPost, deletePost, getPostState } from "../lib/buffer";
import { ActionError } from "../lib/actions";
import { engineForId, engineForNewPosts, engineKeyForId, parseStoredId, toStoredId } from "../lib/publish-engine";

let failures = 0;
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

function throwsActionError(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof ActionError;
  }
}

const BUF = { PUBLISH_ENGINE: "buffer", BUFFER_ACCESS_TOKEN: "t", BUFFER_CHANNEL_X: "cx", BUFFER_CHANNEL_LINKEDIN: "cl", BUFFER_CHANNEL_SUBSTACK: "cs" };
const TF = { TYPEFULLY_API_KEY: "k", TYPEFULLY_PLATFORMS: "x,linkedin,substack" };

async function main() {
  console.log("Resolved publish mode (current env):");
  console.log(`  mode: ${computePublisherMode()}`);
  for (const p of PLATFORMS) console.log(`  ${p.key}: autoPublish=${p.autoPublish}`);

  console.log("\nPUBLISH_ENGINE parsing:");
  assert("unset -> typefully", parsePublishEngine(undefined) === "typefully");
  assert('"" / whitespace -> typefully', parsePublishEngine("") === "typefully" && parsePublishEngine("  ") === "typefully");
  assert('"buffer" / " Buffer " -> buffer', parsePublishEngine("buffer") === "buffer" && parsePublishEngine(" Buffer ") === "buffer");
  assert('"typefully" -> typefully', parsePublishEngine("typefully") === "typefully");
  assert('"hootsuite" -> null (invalid)', parsePublishEngine("hootsuite") === null);
  assert("engineForNewPosts() default -> typefully", engineForNewPosts({}).key === "typefully");
  assert("engineForNewPosts(buffer) -> buffer", engineForNewPosts({ PUBLISH_ENGINE: "buffer" }).key === "buffer");
  assert("engineForNewPosts(invalid) throws", (() => { try { engineForNewPosts({ PUBLISH_ENGINE: "nope" }); return false; } catch { return true; } })());

  console.log("\nStored-id routing (\"Typefully ID\" property):");
  assert("un-prefixed id -> typefully (historical data)", engineKeyForId("abc123") === "typefully");
  assert('"buffer:xyz" -> buffer', engineKeyForId("buffer:xyz") === "buffer");
  assert("typefully id passes through untouched", parseStoredId("abc123").id === "abc123" && parseStoredId("abc123").engine.key === "typefully");
  assert("buffer prefix stripped before the API call", parseStoredId("buffer:xyz").id === "xyz" && parseStoredId("buffer:xyz").engine.key === "buffer");
  assert("toStoredId round-trips both engines", toStoredId("buffer", "xyz") === "buffer:xyz" && toStoredId("typefully", "abc") === "abc");
  assert("engineForId follows the id, not PUBLISH_ENGINE", engineForId("abc").key === "typefully" && engineForId("buffer:z").key === "buffer");
  assert("an id that merely contains 'buffer' is still Typefully", engineKeyForId("mybuffer:1") === "typefully");

  console.log("\nGating matrix — computeAutoPublish(key, env):");
  const plats = ["x", "linkedin", "substack"];
  // Default / legacy Typefully behaviour must be unchanged.
  assert("no env at all -> all manual", plats.every((k) => !computeAutoPublish(k, {})));
  assert("typefully key, default platforms -> x auto, linkedin/substack manual", computeAutoPublish("x", { TYPEFULLY_API_KEY: "k" }) && !computeAutoPublish("linkedin", { TYPEFULLY_API_KEY: "k" }) && !computeAutoPublish("substack", { TYPEFULLY_API_KEY: "k" }));
  assert("typefully key + x,linkedin,substack (PUBLISH_ENGINE unset) -> all auto", plats.every((k) => computeAutoPublish(k, TF)));
  assert("PUBLISH_ENGINE=typefully explicit == unset", plats.every((k) => computeAutoPublish(k, { ...TF, PUBLISH_ENGINE: "typefully" })));
  assert("typefully + PUBLISH_MODE=manual -> all manual", plats.every((k) => !computeAutoPublish(k, { ...TF, PUBLISH_MODE: "manual" })));
  assert("Buffer env alone does NOT enable anything while engine is typefully", plats.every((k) => !computeAutoPublish(k, { ...BUF, PUBLISH_ENGINE: undefined })));
  // Buffer engine.
  assert("buffer: token + all channels -> all three auto", plats.every((k) => computeAutoPublish(k, BUF)));
  assert("buffer: no token -> all manual", plats.every((k) => !computeAutoPublish(k, { ...BUF, BUFFER_ACCESS_TOKEN: undefined })));
  assert("buffer: only X channel -> x auto, others manual", computeAutoPublish("x", { ...BUF, BUFFER_CHANNEL_LINKEDIN: undefined, BUFFER_CHANNEL_SUBSTACK: undefined }) && !computeAutoPublish("linkedin", { ...BUF, BUFFER_CHANNEL_LINKEDIN: undefined }) && !computeAutoPublish("substack", { ...BUF, BUFFER_CHANNEL_SUBSTACK: undefined }));
  assert("buffer ignores TYPEFULLY_PLATFORMS / Typefully key", computeAutoPublish("x", { ...BUF, ...TF, TYPEFULLY_PLATFORMS: "linkedin", BUFFER_CHANNEL_X: "cx" }));
  assert("buffer: typefully key alone (no token) -> manual", !computeAutoPublish("x", { PUBLISH_ENGINE: "buffer", ...TF }));
  assert("buffer + PUBLISH_MODE=manual -> all manual", plats.every((k) => !computeAutoPublish(k, { ...BUF, PUBLISH_MODE: "manual" })));
  assert("invalid PUBLISH_ENGINE -> fail closed (manual)", plats.every((k) => !computeAutoPublish(k, { ...BUF, ...TF, PUBLISH_ENGINE: "nope" })));
  assert("IG keys never auto (no channel env)", !computeAutoPublish("ig-story", BUF) && !computeAutoPublish("ig-carousel", { ...TF }));

  console.log("\nReconciler gate — computeReconciles(key, env):");
  assert("typefully-only env: equals autoPublish", plats.every((k) => computeReconciles(k, TF) === computeAutoPublish(k, TF)));
  assert("no env: nothing reconciles", plats.every((k) => !computeReconciles(k, {})));
  assert("flipped to buffer with Typefully still configured: Typefully-era platforms keep reconciling", plats.every((k) => computeReconciles(k, { ...BUF, ...TF })));
  assert("flipped to buffer, only X channel set, Typefully linkedin queued: linkedin still reconciles", computeReconciles("linkedin", { ...TF, PUBLISH_ENGINE: "buffer", BUFFER_ACCESS_TOKEN: "t", BUFFER_CHANNEL_X: "cx" }));
  assert("rolled back to typefully, Buffer token+channel kept: buffer-queued X still reconciles", computeReconciles("x", { ...BUF, PUBLISH_ENGINE: "typefully", TYPEFULLY_API_KEY: "k" }));
  assert("PUBLISH_MODE=manual stops the reconciler too", plats.every((k) => !computeReconciles(k, { ...BUF, ...TF, PUBLISH_MODE: "manual" })));

  console.log("\npublisher.mode — computePublisherMode(env):");
  assert("empty -> manual", computePublisherMode({}) === "manual");
  assert("typefully key -> typefully", computePublisherMode({ TYPEFULLY_API_KEY: "k" }) === "typefully");
  assert("buffer engine + token + a channel -> buffer", computePublisherMode(BUF) === "buffer");
  assert("buffer engine, token but no channel -> manual", computePublisherMode({ PUBLISH_ENGINE: "buffer", BUFFER_ACCESS_TOKEN: "t" }) === "manual");
  assert("buffer engine, no token -> manual", computePublisherMode({ ...BUF, BUFFER_ACCESS_TOKEN: undefined }) === "manual");
  assert("manual kill switch trumps both", computePublisherMode({ ...BUF, ...TF, PUBLISH_MODE: "manual" }) === "manual");
  assert("invalid engine -> manual", computePublisherMode({ ...BUF, PUBLISH_ENGINE: "x" }) === "manual");

  console.log("\nBuffer request shaping (pure):");
  const SLOT = "2027-01-02T01:00:00.000Z";
  assert("X without break -> null thread", xThreadTexts("one post only") === null);
  const body = "first\n\n---\n\nsecond\n\n---\n\nthird";
  assert("X thread split into trimmed segments", JSON.stringify(xThreadTexts(body)) === JSON.stringify(["first", "second", "third"]));
  const input = buildCreatePostInput({ platform: "x", body, publishAtIso: SLOT, channelId: "ch1" }) as Record<string, unknown> & {
    metadata?: { twitter?: { thread?: { text: string }[] } };
  };
  assert("thread: metadata.twitter.thread has every post incl. first", input.metadata?.twitter?.thread?.length === 3 && input.metadata.twitter.thread[0].text === "first");
  assert("thread: top-level text equals first thread item", input.text === "first");
  assert("scheduled automatic + customScheduled + dueAt ISO UTC", input.schedulingType === "automatic" && input.mode === "customScheduled" && input.dueAt === SLOT && input.channelId === "ch1");
  assert("whitespace-only middle segment -> ActionError", throwsActionError(() => xThreadTexts("a\n\n---\n\n   \n\n---\n\nb")));
  assert("trailing break with empty tail -> ActionError", throwsActionError(() => xThreadTexts("a\n\n---\n\n ")));
  const li = buildCreatePostInput({ platform: "linkedin", body, publishAtIso: SLOT, channelId: "ch2" }) as Record<string, unknown>;
  assert("linkedin: marker not honoured, single post, no metadata", li.metadata === undefined && li.text === body.trim());
  const ss = buildCreatePostInput({ platform: "substack", body, publishAtIso: SLOT, channelId: "ch3" }) as Record<string, unknown>;
  assert("substack: marker not honoured, single post, no metadata", ss.metadata === undefined && ss.text === body.trim());
  assert("dueAt normalised from a +08:00 offset to UTC", (buildCreatePostInput({ platform: "x", body: "hi", publishAtIso: "2027-01-02T09:00:00+08:00", channelId: "c" }) as { dueAt: string }).dueAt === "2027-01-02T01:00:00.000Z");
  assert("status: sent -> published", mapBufferStatus("sent") === "published");
  assert("status: error / scheduled / sending / draft pass through", ["error", "scheduled", "sending", "draft", "needs_approval"].every((s) => mapBufferStatus(s) === s));
  assert("status: SENT (case) -> published; null -> ''", mapBufferStatus("SENT") === "published" && mapBufferStatus(null) === "");

  if (!process.env.BUFFER_ACCESS_TOKEN) {
    assert("current env has no BUFFER_ACCESS_TOKEN -> Buffer never auto-publishes", PLATFORMS.every((p) => !(process.env.PUBLISH_ENGINE?.toLowerCase() === "buffer" && p.autoPublish)));
  }

  const live = process.argv.includes("--live");
  if (!process.env.BUFFER_ACCESS_TOKEN) {
    console.log("\nLive section skipped — BUFFER_ACCESS_TOKEN is unset.");
  } else if (!live) {
    console.log("\nLive section skipped — pass --live to exercise the real Buffer API.");
  } else {
    console.log("\nLive section (real Buffer API calls):");

    console.log("  Listing channels (set BUFFER_CHANNEL_X / _LINKEDIN / _SUBSTACK from these ids)...");
    const channels = await listChannels();
    for (const c of channels) console.log(`    ${c.id}  ${c.service.padEnd(10)} ${c.name}${c.isDisconnected ? "  (DISCONNECTED)" : ""}`);
    assert("at least one channel on the account", channels.length > 0);
    if (channels.length === 0) {
      console.log(`\n${failures} FAILURE(S)`);
      process.exit(1);
    }

    const target =
      channels.find((c) => c.id === process.env.BUFFER_CHANNEL_X) ??
      channels.find((c) => c.service === "twitter" && !c.isDisconnected) ??
      channels.find((c) => !c.isDisconnected) ??
      channels[0];
    // lib/buffer.ts reads the channel id from BUFFER_CHANNEL_X for platform "x"; point it at the chosen channel for this run only.
    process.env.BUFFER_CHANNEL_X = target.id;
    const publishAtIso = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    console.log(`  Creating a post on ${target.service} channel ${target.id} for ${publishAtIso} (never "now")...`);
    const post = await createScheduledPost({
      platform: "x",
      body: "ZZTEST Constitute engine verification — safe to delete",
      publishAtIso,
    });
    console.log(`    created post ${post.id}`);

    try {
      console.log("  Fetching post state...");
      const state = await getPostState(post.id);
      console.log(`    status=${state.status} publishedUrl=${state.publishedUrl ?? "-"}`);
      assert("status is not published (just created, scheduled ~1 year out)", state.status !== "published");
      assert("status is scheduled", state.status === "scheduled");
    } finally {
      console.log("  Deleting post...");
      await deletePost(post.id);
      console.log("    deleted");
    }
    console.log("  Confirming deletion is idempotent (second delete must not throw)...");
    await deletePost(post.id);
    assert("second deletePost on a gone post resolves", true);
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
