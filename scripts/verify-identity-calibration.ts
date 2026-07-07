/**
 * Verification for the Identity Calibration layer. Run with:
 *
 *   npx tsx scripts/verify-identity-calibration.ts --url http://localhost:3000
 *   (or: npm run verify:identity-calibration -- --url http://localhost:3000)
 *
 * If HERMES_API_TOKEN is unset, prints "machine lane disabled — set
 * HERMES_API_TOKEN" and exits 0 — same convention as the other verify scripts.
 *
 * Exercises amendment generation end-to-end, over the machine lane where
 * possible and direct lib/Notion calls where the surface is session-authed:
 *   (a) create a throwaway Draft, `edit` it via POST /api/hermes/decisions →
 *       asserts a pending amendment was generated with targetType "voice",
 *       targetRef "x", confidence "low".
 *   (b) create another Draft, `reject` it WITH a reason → asserts a pending
 *       amendment with targetType "unclassified" and the reason as proposed text.
 *   (c) PATCH the voice amendment (reclassify + edit text) via lib updateProposal
 *       (the PATCH route is session-lane), accept it via setProposalStatus, then
 *       re-read → asserts status "accepted", text updated, targetType changed.
 *   (d) archives EVERY page it created — drafts, proposal rows, and any
 *       calibration events pointing at those drafts.
 *
 * Only ever creates and archives its own throwaway pages
 * (titled "VERIFY-IDCAL — safe to delete"); never touches a real draft/position.
 */

import "dotenv/config";
import { getProposal, queryProposals, setProposalStatus, updateProposal } from "../lib/proposals";
import { queryCalibrationEvents } from "../lib/calibration-events";
import { getPage, notionFetch, readStatus } from "../lib/notion";

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
  if (!process.env.DS_PROPOSALS) {
    console.log("DS_PROPOSALS not set — run `npm run migrate` first, then re-run this script.");
    process.exit(0);
  }

  const baseUrl = (argValue("--url") ?? "http://localhost:3000").replace(/\/$/, "");
  const draftsUrl = `${baseUrl}/api/hermes/drafts`;
  const decisionsUrl = `${baseUrl}/api/hermes/decisions`;
  console.log(`Verifying Identity Calibration at ${baseUrl}\n`);

  const createdPageIds: string[] = [];
  const createdProposalIds: string[] = [];

  async function createDraft(label: string): Promise<string | null> {
    const res = await fetch(draftsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        platform: "x",
        title: "VERIFY-IDCAL — safe to delete",
        body: `Throwaway draft for the ${label} amendment path — archived automatically at the end of the run.`,
        sourceWorkflow: "verify-identity-calibration.ts",
        humanizerStatus: "unknown",
        createdBy: "hermes",
      }),
    });
    if (res.status !== 201) {
      console.log(`  could not create ${label} draft (status ${res.status})`);
      return null;
    }
    const created = await res.json();
    if (typeof created.id === "string" && created.id) {
      createdPageIds.push(created.id);
      return created.id;
    }
    return null;
  }

  async function postDecision(payload: Record<string, unknown>) {
    const res = await fetch(decisionsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function findPendingByProposedText(marker: string) {
    const pending = await queryProposals({ status: "pending", limit: 100 });
    return pending.find((p) => p.proposedPositionText === marker) ?? null;
  }

  try {
    // --- (a) draft edit → voice amendment ----------------------------------
    console.log("Draft edit → voice amendment:");
    const editId = await createDraft("edit");
    const MARKER_EDIT = `VERIFY-IDCAL edited body ${Date.now()}`;
    if (editId) {
      const { status } = await postDecision({
        pageId: editId,
        action: "edit",
        editedText: MARKER_EDIT,
        source: "telegram",
      });
      assert("edit decision → 200", status === 200);
      const voice = await findPendingByProposedText(MARKER_EDIT);
      assert("voice amendment generated", !!voice);
      if (voice) {
        createdProposalIds.push(voice.id);
        assert("targetType is voice", voice.targetType === "voice");
        assert("targetRef is x", voice.targetRef === "x");
        assert("confidence is low", voice.confidence === "low");

        // --- (c) PATCH (reclassify + edit text) then accept ----------------
        console.log("\nPATCH (reclassify + edit text) then accept:");
        const MARKER_EDIT2 = `VERIFY-IDCAL patched text ${Date.now()}`;
        await updateProposal(voice.id, { targetType: "constitution", proposedText: MARKER_EDIT2 });
        const accepted = await setProposalStatus(voice.id, "accepted");
        assert("setProposalStatus returns accepted", accepted.status === "accepted");
        const reread = await getProposal(voice.id);
        assert("re-read status is accepted", reread.status === "accepted");
        assert("proposed text updated", reread.proposedPositionText === MARKER_EDIT2);
        assert("targetType reclassified to constitution", reread.targetType === "constitution");
      }
    } else {
      assert("edit path — draft created", false);
    }

    // --- (b) draft reject with reason → unclassified amendment -------------
    console.log("\nDraft reject (with reason) → unclassified amendment:");
    const rejectId = await createDraft("reject");
    const MARKER_REASON = `VERIFY-IDCAL rejection reason ${Date.now()}`;
    if (rejectId) {
      const { status } = await postDecision({
        pageId: rejectId,
        action: "reject",
        reason: MARKER_REASON,
        source: "telegram",
      });
      assert("reject decision → 200", status === 200);
      const unclassified = await findPendingByProposedText(MARKER_REASON);
      assert("unclassified amendment generated", !!unclassified);
      if (unclassified) {
        createdProposalIds.push(unclassified.id);
        assert("targetType is unclassified", unclassified.targetType === "unclassified");
        assert("proposed text is the reason verbatim", unclassified.proposedPositionText === MARKER_REASON);
      }
    } else {
      assert("reject path — draft created", false);
    }
  } finally {
    // --- (d) cleanup — archive drafts, amendments, and their events --------
    console.log("\nCleanup:");
    // Calibration events pointing at our throwaway drafts (best-effort).
    try {
      const events = await queryCalibrationEvents({ limit: 100 });
      for (const e of events) {
        if (createdPageIds.includes(e.objectId)) createdProposalIds.push(e.id);
      }
    } catch (err) {
      console.log(`  WARN — could not scan calibration events: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const id of [...createdPageIds, ...createdProposalIds]) {
      try {
        await notionFetch(`/pages/${id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
        console.log(`  archived ${id}`);
      } catch (err) {
        console.log(`  WARN — could not archive ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Sanity: report the final Notion status of any draft we can still read.
    for (const id of createdPageIds) {
      try {
        console.log(`  draft ${id} final status: ${readStatus(await getPage(id))}`);
      } catch {
        /* archived — expected */
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
