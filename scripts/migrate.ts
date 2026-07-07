/**
 * Schema migration (PRD §6.2/§6.3) — run once, idempotent, strictly additive.
 * Never renames or removes existing properties (other agents depend on them).
 *
 *   NOTION_TOKEN=... npm run migrate
 *
 * 1. Extends the 4 content DBs with: Typefully ID, Scheduled At, Approved At,
 *    Edited Before Approval, Original Draft.
 * 2. Ensures Status options Draft/Approved/Queued/Posted/Rejected exist
 *    (select-type only — Notion's API cannot add options to status-type
 *    properties; the script prints manual instructions in that case).
 * 3. Creates the "Pipeline Events" DB under the Constitution hub if missing
 *    and prints its data source id for DS_EVENTS.
 * 4. Creates the "Calibration Events" DB under the Constitution hub if
 *    missing (Phase 3 — see docs/hermes-calibration-plan.md §4.1) and prints
 *    its data source id for DS_CALIBRATION_EVENTS.
 * 5. Creates the "Position Proposals" DB under the Constitution hub if
 *    missing (Phase 4 — see docs/hermes-calibration-plan.md §4.2) and prints
 *    its data source id for DS_PROPOSALS.
 */

import "dotenv/config";

const NOTION_BASE = "https://api.notion.com/v1";
const VERSION = process.env.NOTION_VERSION || "2025-09-03";
const HUB_PAGE_ID = "3651fec9-ef83-811b-a9ec-f530474ec779";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function notion(path: string, init?: RequestInit): Promise<Json> {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error("NOTION_TOKEN is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  const res = await fetch(`${NOTION_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": VERSION,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Notion ${res.status} on ${path}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

const CONTENT_DS: { env: string; label: string }[] = [
  { env: "DS_X", label: "X Daily Tweets" },
  { env: "DS_LINKEDIN", label: "LinkedIn Posts" },
  { env: "DS_IG_STORY", label: "IG Story Posts" },
  { env: "DS_IG_CAROUSEL", label: "IG Carousel Posts" },
];

const NEW_PROPS: Record<string, Json> = {
  "Typefully ID": { rich_text: {} },
  "Scheduled At": { date: {} },
  "Approved At": { date: {} },
  "Edited Before Approval": { checkbox: {} },
  "Original Draft": { rich_text: {} },
  // Phase 7 — draft creation bridge (docs/hermes-calibration-plan.md §4.4).
  // Additive provenance props written by lib/items.ts `createDraft()`.
  "Created By": {
    select: {
      options: [{ name: "agent" }, { name: "hermes" }, { name: "manual" }],
    },
  },
  "Source Workflow": { rich_text: {} },
  Humanizer: {
    select: {
      options: [{ name: "passed" }, { name: "failed" }, { name: "unknown" }],
    },
  },
  "Source Position IDs": { rich_text: {} },
};

const STATUS_OPTIONS = ["Draft", "Approved", "Queued", "Posted", "Rejected"];

async function migrateContentDs(env: string, label: string) {
  const id = process.env[env];
  if (!id) {
    console.log(`✗ ${label}: ${env} not set — skipping`);
    return;
  }
  const ds = await notion(`/data_sources/${id}`);
  const props: Json = ds.properties ?? {};
  console.log(`\n— ${label} (${id})`);

  // 1. Add missing properties (additive only)
  const toAdd: Record<string, Json> = {};
  for (const [name, def] of Object.entries(NEW_PROPS)) {
    const existing = Object.keys(props).find((k) => k.toLowerCase() === name.toLowerCase());
    if (existing) {
      console.log(`  = "${name}" already present`);
    } else {
      toAdd[name] = def;
    }
  }
  if (Object.keys(toAdd).length > 0) {
    await notion(`/data_sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: toAdd }),
    });
    console.log(`  + added: ${Object.keys(toAdd).join(", ")}`);
  }

  // 2. Status options
  const statusEntry = Object.entries(props).find(([k]) => k.toLowerCase() === "status");
  if (!statusEntry) {
    console.log(`  ! No Status property found — create one in Notion with options: ${STATUS_OPTIONS.join(", ")}`);
    return;
  }
  const [statusName, statusDef] = statusEntry as [string, Json];
  if (statusDef.type === "select") {
    const existingNames: string[] = (statusDef.select?.options ?? []).map((o: Json) => o.name);
    const missing = STATUS_OPTIONS.filter((o) => !existingNames.includes(o));
    if (missing.length === 0) {
      console.log(`  = Status options complete (${existingNames.join(", ")})`);
    } else {
      // PATCH with the full option list (existing options keep their ids/colours)
      await notion(`/data_sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          properties: {
            [statusName]: {
              select: {
                options: [
                  ...(statusDef.select?.options ?? []).map((o: Json) => ({ name: o.name, color: o.color })),
                  ...missing.map((name) => ({ name })),
                ],
              },
            },
          },
        }),
      });
      console.log(`  + Status options added: ${missing.join(", ")}`);
    }
  } else if (statusDef.type === "status") {
    const existingNames: string[] = (statusDef.status?.options ?? []).map((o: Json) => o.name);
    const missing = STATUS_OPTIONS.filter((o) => !existingNames.includes(o));
    if (missing.length === 0) {
      console.log(`  = Status options complete (status-type)`);
    } else {
      console.log(
        `  ! Status is a status-type property; the API cannot add options.\n` +
          `    Add these manually in Notion (${label} → Status property): ${missing.join(", ")}`
      );
    }
  } else {
    console.log(`  ! Status property is type "${statusDef.type}" — expected select or status`);
  }
}

async function ensureEventsDb(): Promise<void> {
  console.log(`\n— Pipeline Events`);
  // Look for an existing Pipeline Events data source first (idempotency)
  const search = await notion(`/search`, {
    method: "POST",
    body: JSON.stringify({ query: "Pipeline Events", filter: { property: "object", value: "data_source" } }),
  });
  const existing = (search.results ?? []).find(
    (ds: Json) => ((ds.title ?? []).map((t: Json) => t.plain_text).join("") || "").trim() === "Pipeline Events"
  );
  if (existing) {
    console.log(`  = Already exists. DS_EVENTS=${existing.id}`);
    return;
  }
  const db = await notion(`/databases`, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: HUB_PAGE_ID },
      title: [{ type: "text", text: { content: "Pipeline Events" } }],
      initial_data_source: {
        properties: {
          Name: { title: {} },
          Event: {
            select: {
              options: [
                { name: "Approved", color: "green" },
                { name: "Approved-with-edits", color: "yellow" },
                { name: "Rejected", color: "gray" },
                { name: "Queued", color: "orange" },
                { name: "Posted", color: "blue" },
                { name: "Publish-failed", color: "red" },
              ],
            },
          },
          Platform: {
            select: {
              options: [
                { name: "X" },
                { name: "LinkedIn" },
                { name: "IG Story" },
                { name: "IG Carousel" },
              ],
            },
          },
          Item: { url: {} },
          Timestamp: { date: {} },
          Diff: { rich_text: {} },
          Notes: { rich_text: {} },
        },
      },
    }),
  });
  const dsId = db.data_sources?.[0]?.id ?? "(check the new DB in Notion)";
  console.log(`  + Created under Constitution hub. Set DS_EVENTS=${dsId}`);
}

async function ensureCalibrationEventsDb(): Promise<void> {
  console.log(`\n— Calibration Events`);
  // Search-first for an existing data source with this title (same
  // idempotency style as ensureEventsDb).
  const search = await notion(`/search`, {
    method: "POST",
    body: JSON.stringify({ query: "Calibration Events", filter: { property: "object", value: "data_source" } }),
  });
  const existing = (search.results ?? []).find(
    (ds: Json) => ((ds.title ?? []).map((t: Json) => t.plain_text).join("") || "").trim() === "Calibration Events"
  );
  if (existing) {
    console.log(`  = Already exists. DS_CALIBRATION_EVENTS=${existing.id}`);
    return;
  }
  const db = await notion(`/databases`, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: HUB_PAGE_ID },
      title: [{ type: "text", text: { content: "Calibration Events" } }],
      initial_data_source: {
        properties: {
          Name: { title: {} },
          Source: {
            select: {
              options: [{ name: "command_center" }, { name: "telegram" }, { name: "hermes" }],
            },
          },
          "Object Type": {
            select: {
              options: [
                { name: "draft" },
                { name: "position" },
                { name: "calibration_card" },
                { name: "wiki_note" },
              ],
            },
          },
          "Object ID": { rich_text: {} },
          Platform: {
            select: {
              options: [
                { name: "x" },
                { name: "linkedin" },
                { name: "ig_story" },
                { name: "ig_carousel" },
                { name: "unknown" },
              ],
            },
          },
          Topic: { rich_text: {} },
          Action: {
            select: {
              options: [
                { name: "approve" },
                { name: "reject" },
                { name: "edit" },
                { name: "confirm" },
                { name: "sharpen" },
                { name: "submit" },
                { name: "later" },
              ],
            },
          },
          "Raw User Text": { rich_text: {} },
          "Previous Text": { rich_text: {} },
          "New Text": { rich_text: {} },
          "Affected Position IDs": { rich_text: {} },
          "Inferred Delta": { rich_text: {} },
          Status: {
            select: {
              options: [
                { name: "pending" },
                { name: "accepted" },
                { name: "rejected" },
                { name: "applied" },
              ],
            },
          },
        },
      },
    }),
  });
  const dsId = db.data_sources?.[0]?.id ?? "(check the new DB in Notion)";
  console.log(`  + Created under Constitution hub. Set DS_CALIBRATION_EVENTS=${dsId}`);
}

async function ensurePositionProposalsDb(): Promise<void> {
  console.log(`\n— Position Proposals`);
  // Search-first for an existing data source with this title (same
  // idempotency style as ensureEventsDb / ensureCalibrationEventsDb).
  const search = await notion(`/search`, {
    method: "POST",
    body: JSON.stringify({ query: "Position Proposals", filter: { property: "object", value: "data_source" } }),
  });
  const existing = (search.results ?? []).find(
    (ds: Json) => ((ds.title ?? []).map((t: Json) => t.plain_text).join("") || "").trim() === "Position Proposals"
  );
  if (existing) {
    console.log(`  = Already exists. DS_PROPOSALS=${existing.id}`);
    return;
  }
  const db = await notion(`/databases`, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: HUB_PAGE_ID },
      title: [{ type: "text", text: { content: "Position Proposals" } }],
      initial_data_source: {
        properties: {
          Name: { title: {} },
          "Source Event IDs": { rich_text: {} },
          "Affected Position ID": { rich_text: {} },
          Topic: { rich_text: {} },
          "Current Position Text": { rich_text: {} },
          "Proposed Position Text": { rich_text: {} },
          Reason: { rich_text: {} },
          "Evidence Summary": { rich_text: {} },
          Confidence: {
            select: {
              options: [{ name: "low" }, { name: "medium" }, { name: "high" }],
            },
          },
          Status: {
            select: {
              options: [
                { name: "pending" },
                { name: "accepted" },
                { name: "rejected" },
                { name: "applied" },
              ],
            },
          },
        },
      },
    }),
  });
  const dsId = db.data_sources?.[0]?.id ?? "(check the new DB in Notion)";
  console.log(`  + Created under Constitution hub. Set DS_PROPOSALS=${dsId}`);
}

async function main() {
  console.log(`Notion-Version: ${VERSION}`);
  console.log("Additive schema migration — existing properties are never renamed or removed.");
  for (const { env, label } of CONTENT_DS) {
    try {
      await migrateContentDs(env, label);
    } catch (err) {
      console.log(`✗ ${label}: ${err instanceof Error ? err.message : err}`);
    }
  }
  try {
    await ensureEventsDb();
  } catch (err) {
    console.log(`✗ Pipeline Events: ${err instanceof Error ? err.message : err}`);
  }
  try {
    await ensureCalibrationEventsDb();
  } catch (err) {
    console.log(`✗ Calibration Events: ${err instanceof Error ? err.message : err}`);
  }
  try {
    await ensurePositionProposalsDb();
  } catch (err) {
    console.log(`✗ Position Proposals: ${err instanceof Error ? err.message : err}`);
  }
  console.log("\nDone. Re-running is safe (idempotent).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
