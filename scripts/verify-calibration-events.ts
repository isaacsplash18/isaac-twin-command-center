/**
 * Verification for CalibrationEvents (Phase 3). Run with:
 *
 *   npx tsx scripts/verify-calibration-events.ts
 *   (or: npm run verify:calibration-events)
 *
 * If DS_CALIBRATION_EVENTS is unset, prints a "run migration first" message
 * and exits 0 — that's the expected pre-migration state; the app must keep
 * working either way. Otherwise this creates one throwaway event via
 * logCalibrationEvent(), reads it back via queryCalibrationEvents(), asserts
 * a field round-trip, then archives the test page. Never touches real
 * drafts or Positions.
 */

import "dotenv/config";
import { logCalibrationEvent, queryCalibrationEvents } from "../lib/calibration-events";
import { notionFetch } from "../lib/notion";

async function main() {
  const ds = process.env.DS_CALIBRATION_EVENTS;
  if (!ds) {
    console.log("DS_CALIBRATION_EVENTS is not set.");
    console.log(
      "Run `npm run migrate` first (creates the Calibration Events DB), then paste the printed\n" +
        "data source id into .env as DS_CALIBRATION_EVENTS and re-run this script."
    );
    process.exit(0);
  }

  console.log(`Using DS_CALIBRATION_EVENTS=${ds}\n`);

  const testInput = {
    action: "submit" as const,
    objectType: "calibration_card" as const,
    objectId: `verify-script-${Date.now()}`,
    topic: "VERIFY-SCRIPT",
    rawUserText: "Verification round-trip text.",
    previousText: "before",
    newText: "after",
    affectedPositionIds: ["fake-position-id-1", "fake-position-id-2"],
    inferredDelta: "answer-recorded",
  };

  console.log("Creating test event via logCalibrationEvent()...");
  const created = await logCalibrationEvent(testInput);
  if (!created) {
    console.log("FAIL: logCalibrationEvent() returned null (check DS_CALIBRATION_EVENTS / NOTION_TOKEN).");
    process.exit(1);
  }
  console.log(`  created page id: ${created.id}\n`);

  console.log("Reading back via queryCalibrationEvents()...");
  const events = await queryCalibrationEvents({ limit: 25 });
  const found = events.find((e) => e.id === created.id);

  let failures = 0;
  const assert = (label: string, cond: boolean) => {
    console.log(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
    if (!cond) failures++;
  };

  assert("event found in query results", !!found);
  if (found) {
    assert("action round-trips", found.action === testInput.action);
    assert("objectType round-trips", found.objectType === testInput.objectType);
    assert("objectId round-trips", found.objectId === testInput.objectId);
    assert("topic round-trips", found.topic === testInput.topic);
    assert("rawUserText round-trips", found.rawUserText === testInput.rawUserText);
    assert("previousText round-trips", found.previousText === testInput.previousText);
    assert("newText round-trips", found.newText === testInput.newText);
    assert(
      "affectedPositionIds round-trips",
      JSON.stringify(found.affectedPositionIds) === JSON.stringify(testInput.affectedPositionIds)
    );
    assert("inferredDelta round-trips", found.inferredDelta === testInput.inferredDelta);
    assert("status defaults to pending", found.status === "pending");
    assert("createdAt is a valid ISO timestamp", !Number.isNaN(Date.parse(found.createdAt)));
  }

  console.log("\nArchiving test page (cleanup)...");
  await notionFetch(`/pages/${created.id}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  });
  console.log("  done.");

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
