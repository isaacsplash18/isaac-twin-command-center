/**
 * Verification for PositionUpdateProposals (Phase 4). Run with:
 *
 *   npx tsx scripts/verify-proposals.ts
 *   npx tsx scripts/verify-proposals.ts --position-id <real-position-page-id>
 *   (or: npm run verify:proposals)
 *
 * If DS_PROPOSALS is unset, prints a "run migration first" message and exits 0
 * — the app must keep working pre-migration.
 *
 * Default run (no --position-id): exercises the deterministic generator's
 * negative gates purely in memory (no event page is written), then does a
 * DS_PROPOSALS round-trip using a directly-created proposal page:
 * queryProposals finds it → setProposalStatus accepted → re-read asserts
 * accepted → archive. Never touches real drafts or Positions.
 *
 * With --position-id <id>: additionally synthesizes an in-memory sharpen
 * CalibrationEvent pointing at that real position, runs the generator end-to-end
 * (reads current position text, creates a pending proposal), asserts the
 * round-trip and idempotency, then archives the generated proposal.
 */

import "dotenv/config";
import type { CalibrationEvent } from "../lib/calibration-events";
import { getProposal, maybeCreateProposalFromEvent, queryProposals, setProposalStatus } from "../lib/proposals";
import { getDataSourceSchema, notionFetch, richTextValue, titlePropertyName } from "../lib/notion";

let failures = 0;
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) failures++;
}

function makeEvent(overrides: Partial<CalibrationEvent>): CalibrationEvent {
  return {
    id: `verify-event-${Date.now()}`,
    createdAt: new Date().toISOString(),
    source: "command_center",
    objectType: "calibration_card",
    objectId: `verify-block-${Date.now()}`,
    platform: "unknown",
    topic: "VERIFY-SCRIPT",
    action: "sharpen",
    rawUserText: "Isaac's sharpened take, in his own words.",
    previousText: "",
    newText: "",
    affectedPositionIds: [],
    inferredDelta: "position-sharpened",
    status: "pending",
    ...overrides,
  };
}

async function main() {
  const ds = process.env.DS_PROPOSALS;
  if (!ds) {
    console.log("DS_PROPOSALS is not set.");
    console.log(
      "Run `npm run migrate` first (creates the Position Proposals DB), then paste the printed\n" +
        "data source id into .env as DS_PROPOSALS and re-run this script."
    );
    process.exit(0);
  }
  console.log(`Using DS_PROPOSALS=${ds}\n`);

  // --- Negative gates (in memory, no position fetch, no page written) --------
  console.log("Generator negative gates:");
  assert(
    "confirm action → null",
    (await maybeCreateProposalFromEvent(
      makeEvent({ action: "confirm", affectedPositionIds: ["pos-1"] })
    )) === null
  );
  assert(
    "empty rawUserText → null",
    (await maybeCreateProposalFromEvent(
      makeEvent({ rawUserText: "   ", affectedPositionIds: ["pos-1"] })
    )) === null
  );
  assert(
    "no affectedPositionIds → null",
    (await maybeCreateProposalFromEvent(makeEvent({ affectedPositionIds: [] }))) === null
  );
  assert("null event → null", (await maybeCreateProposalFromEvent(null)) === null);

  // --- DS round-trip via a directly-created proposal page --------------------
  console.log("\nDS_PROPOSALS round-trip (direct page):");
  const schema = await getDataSourceSchema(ds);
  const titleProp = titlePropertyName(schema);
  const marker = `VERIFY-SCRIPT-${Date.now()}`;

  // Archive every proposal page we create, even if an assertion/network call
  // below throws midway (writes to a log DB — lower harm than the draft
  // bridge, but the same unguarded-cleanup pattern applies).
  const createdProposalIds: string[] = [];
  try {
    const created = await notionFetch(`/pages`, {
      method: "POST",
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: ds },
        properties: {
          [titleProp]: { title: [{ type: "text", text: { content: marker } }] },
          "Affected Position ID": richTextValue(`verify-pos-${Date.now()}`),
          Topic: richTextValue(marker),
          "Current Position Text": richTextValue("current text"),
          "Proposed Position Text": richTextValue("proposed text"),
          Reason: richTextValue("verification"),
          "Evidence Summary": richTextValue("verify round-trip"),
          Confidence: { select: { name: "low" } },
          Status: { select: { name: "pending" } },
        },
      }),
    });
    createdProposalIds.push(created.id);
    console.log(`  created proposal id: ${created.id}`);

    const pending = await queryProposals({ status: "pending", limit: 100 });
    const found = pending.find((p) => p.id === created.id);
    assert("queryProposals(pending) finds it", !!found);
    if (found) {
      assert("topic round-trips", found.topic === marker);
      assert("confidence round-trips", found.confidence === "low");
      assert("status is pending", found.status === "pending");
      assert("createdAt is valid ISO", !Number.isNaN(Date.parse(found.createdAt)));
      assert("updatedAt is valid ISO", !Number.isNaN(Date.parse(found.updatedAt)));
    }

    const accepted = await setProposalStatus(created.id, "accepted");
    assert("setProposalStatus returns accepted", accepted.status === "accepted");
    const reread = await getProposal(created.id);
    assert("re-read confirms accepted", reread.status === "accepted");

    // --- Optional end-to-end generation against a real position --------------
    const posArgIdx = process.argv.indexOf("--position-id");
    const positionId = posArgIdx >= 0 ? process.argv[posArgIdx + 1] : undefined;
    if (positionId) {
      console.log(`\nEnd-to-end generation against position ${positionId}:`);
      const gen = await maybeCreateProposalFromEvent(
        makeEvent({ action: "sharpen", affectedPositionIds: [positionId], rawUserText: "E2E sharpened take." })
      );
      assert("generator created a proposal", !!gen);
      if (gen) {
        createdProposalIds.push(gen.id);
        assert("proposed text is Isaac's verbatim words", gen.proposedPositionText === "E2E sharpened take.");
        assert("confidence is medium (sharpen)", gen.confidence === "medium");
        assert("affectedPositionId matches", gen.affectedPositionId === positionId);
        assert("status is pending", gen.status === "pending");
        const dup = await maybeCreateProposalFromEvent(
          makeEvent({ action: "sharpen", affectedPositionIds: [positionId], rawUserText: "second take." })
        );
        assert("idempotency: second proposal for same pending position → null", dup === null);
      }
    } else {
      console.log("\n(Skipping end-to-end generation — pass --position-id <id> to exercise it.)");
    }
  } finally {
    console.log("\nCleanup:");
    for (const id of createdProposalIds) {
      try {
        await notionFetch(`/pages/${id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
        console.log(`  archived proposal ${id}`);
      } catch (err) {
        console.log(`  WARN — could not archive ${id}: ${err instanceof Error ? err.message : String(err)}`);
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
