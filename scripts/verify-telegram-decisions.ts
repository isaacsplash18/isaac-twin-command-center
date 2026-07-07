/**
 * Verification for the Telegram approval bridge write-back (Phase 9 —
 * docs/telegram-approval-bridge.md §2/§5/§6). Run with:
 *
 *   npx tsx scripts/verify-telegram-decisions.ts
 *   npx tsx scripts/verify-telegram-decisions.ts --url http://localhost:3100
 *   (or: npm run verify:telegram-decisions -- --url http://localhost:3100)
 *
 * If HERMES_API_TOKEN is unset, prints "machine lane disabled — set
 * HERMES_API_TOKEN" and exits 0 — same convention as verify-draft-bridge.ts /
 * verify-hermes-export.ts.
 *
 * Otherwise, over the machine lane:
 *   (a) POST /api/hermes/decisions with no Authorization header → 401, and with
 *       a wrong Bearer token → 401.
 *   (b) create a throwaway Draft, `approve` it → asserts 200 { noop:false } and
 *       Notion Status = Approved.
 *   (c) create another throwaway Draft, `reject` with a reason → asserts 200 and
 *       Notion Status = Rejected.
 *   (d) create another throwaway Draft, `edit` (edit-then-approve) → asserts 200,
 *       Notion Status = Approved, and `Edited Before Approval` = true.
 *   (e) re-POST `approve` on the already-approved page from (b) → asserts
 *       200 { noop:true, note:"already-decided" } (status-based idempotency).
 *   (f) archives every test page it created (Notion archived:true).
 *
 * This script only ever creates and archives its own throwaway pages
 * (titled "VERIFY-TG-DECISIONS — safe to delete"); it never touches a real draft.
 */

import "dotenv/config";
import { getPage, notionFetch, readCheckboxProp, readStatus } from "../lib/notion";

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

  const baseUrl = (argValue("--url") ?? "http://localhost:3000").replace(/\/$/, "");
  const draftsUrl = `${baseUrl}/api/hermes/drafts`;
  const decisionsUrl = `${baseUrl}/api/hermes/decisions`;
  console.log(`Verifying Telegram decisions bridge at ${decisionsUrl}\n`);

  // Track every page we create so we can archive them all, even on failure.
  const createdPageIds: string[] = [];

  async function createDraft(label: string): Promise<string | null> {
    const res = await fetch(draftsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        platform: "x",
        title: "VERIFY-TG-DECISIONS — safe to delete",
        body: `Throwaway draft for the ${label} decision path — archived automatically at the end of the run.`,
        sourceWorkflow: "verify-telegram-decisions.ts",
        humanizerStatus: "unknown",
        createdBy: "hermes",
      }),
    });
    if (res.status !== 201) {
      const errBody = await res.text().catch(() => "");
      console.log(`  could not create ${label} draft (status ${res.status}): ${errBody.slice(0, 300)}`);
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
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  try {
    // --- (a) auth -----------------------------------------------------------
    console.log("Unauthenticated requests:");
    const unauth = await fetch(decisionsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: "x", action: "approve" }),
    });
    assert("no Authorization header → 401", unauth.status === 401);

    const wrongAuth = await fetch(decisionsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not-the-real-token" },
      body: JSON.stringify({ pageId: "x", action: "approve" }),
    });
    assert("wrong Bearer token → 401", wrongAuth.status === 401);

    // --- (b) approve --------------------------------------------------------
    console.log("\nApprove path:");
    const approveId = await createDraft("approve");
    if (approveId) {
      const { status, body } = await postDecision({
        pageId: approveId,
        action: "approve",
        source: "telegram",
        idempotencyKey: "tg:verify:approve",
      });
      assert("approve → 200", status === 200);
      assert("approve response ok:true", !!body && body.ok === true);
      assert("approve response noop:false", !!body && body.noop === false);
      assert("approve response status Approved", !!body && body.status === "Approved");
      assert("approve echoes idempotencyKey", !!body && body.idempotencyKey === "tg:verify:approve");
      assert("Notion Status is Approved", readStatus(await getPage(approveId)) === "Approved");
    } else {
      assert("approve path — draft created", false);
    }

    // --- (c) reject with reason --------------------------------------------
    console.log("\nReject path:");
    const rejectId = await createDraft("reject");
    if (rejectId) {
      const { status, body } = await postDecision({
        pageId: rejectId,
        action: "reject",
        reason: "Off-voice — too promotional for the calibration test.",
        source: "telegram",
      });
      assert("reject → 200", status === 200);
      assert("reject response status Rejected", !!body && body.status === "Rejected");
      assert("Notion Status is Rejected", readStatus(await getPage(rejectId)) === "Rejected");
    } else {
      assert("reject path — draft created", false);
    }

    // --- (d) edit → approve -------------------------------------------------
    console.log("\nEdit-approve path:");
    const editId = await createDraft("edit");
    if (editId) {
      const { status, body } = await postDecision({
        pageId: editId,
        action: "edit",
        editedText: "Full replacement body from the verify-telegram-decisions.ts edit path.",
        source: "telegram",
      });
      assert("edit-approve → 200", status === 200);
      assert("edit-approve response status Approved", !!body && body.status === "Approved");
      const page = await getPage(editId);
      assert("Notion Status is Approved", readStatus(page) === "Approved");
      assert("Edited Before Approval is true", readCheckboxProp(page, "Edited Before Approval") === true);
    } else {
      assert("edit path — draft created", false);
    }

    // --- (e) idempotent no-op on an already-decided page --------------------
    console.log("\nAlready-decided (noop) path:");
    if (approveId) {
      const { status, body } = await postDecision({
        pageId: approveId,
        action: "approve",
        source: "telegram",
      });
      assert("re-approve → 200", status === 200);
      assert("re-approve response noop:true", !!body && body.noop === true);
      assert('re-approve note "already-decided"', !!body && body.note === "already-decided");
      assert("re-approve response status still Approved", !!body && body.status === "Approved");
    } else {
      assert("noop path — approved draft available", false);
    }
  } finally {
    // --- (f) cleanup — archive every test page ------------------------------
    console.log("\nCleanup:");
    for (const id of createdPageIds) {
      try {
        await notionFetch(`/pages/${id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
        console.log(`  archived test page ${id}`);
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
