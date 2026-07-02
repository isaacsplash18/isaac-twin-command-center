/**
 * Discovery script (PRD §6.1, §13): confirms the data source IDs the app is
 * configured with, and prints every database + data source the integration
 * can see, with property schemas. Run with:
 *
 *   NOTION_TOKEN=... npm run discover
 *
 * The LinkedIn *database* id 41ac05db-b314-46fb-af4e-aeba3404277e can seed
 * verification that MCP collection ids map 1:1 to official-API data sources.
 */

import "dotenv/config";

const NOTION_BASE = "https://api.notion.com/v1";
const VERSION = process.env.NOTION_VERSION || "2025-09-03";

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
  if (!res.ok) throw new Error(`Notion ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const EXPECTED: Record<string, string> = {
  DS_X: "a5d8469f-8807-4e66-b8b7-31dbf414d103",
  DS_LINKEDIN: "daa5bffd-96b9-4864-aca0-61a8a1bfdf11",
  DS_IG_STORY: "58dd1e1a-a868-4b86-8690-14945ec72cba",
  DS_IG_CAROUSEL: "5fdd5231-f28d-4cb9-b1a2-b3389d6e972b",
  DS_POSITIONS: "fd5f9efb-721d-40b5-b932-bf198e88f953",
  DS_INBOX: "02d3dbb3-50d6-47d3-951d-5b05d46a8699",
  DS_WIKI: "2316d4b5-2d25-44d4-87e5-13539945fd8b",
};

function propSummary(props: Json): string {
  return Object.entries(props ?? {})
    .map(([k, v]) => `${k}:${(v as Json).type}`)
    .join(", ");
}

async function main() {
  console.log(`Notion-Version: ${VERSION}\n`);

  // 1. Everything the integration can see
  console.log("=== Databases visible to this integration ===\n");
  let cursor: string | undefined;
  const seenDataSources = new Map<string, { dbTitle: string; dsName: string }>();
  do {
    const resp = await notion("/search", {
      method: "POST",
      body: JSON.stringify({
        filter: { property: "object", value: "data_source" },
        start_cursor: cursor,
        page_size: 100,
      }),
    });
    for (const ds of resp.results) {
      const title = (ds.title ?? []).map((t: Json) => t.plain_text).join("") || "(untitled)";
      seenDataSources.set(ds.id.replace(/-/g, ""), { dbTitle: title, dsName: title });
      console.log(`• ${title}`);
      console.log(`  data source id: ${ds.id}`);
      console.log(`  database id:    ${ds.parent?.database_id ?? "?"}`);
      console.log(`  properties:     ${propSummary(ds.properties)}\n`);
    }
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);

  // 2. Verify the PRD ids resolve
  console.log("=== Verifying configured data source IDs ===\n");
  for (const [envName, id] of Object.entries(EXPECTED)) {
    const configured = process.env[envName] || id;
    try {
      const ds = await notion(`/data_sources/${configured}`);
      const title = (ds.title ?? []).map((t: Json) => t.plain_text).join("");
      const statusProp = Object.entries(ds.properties ?? {}).find(([k]) => k.toLowerCase() === "status");
      console.log(`✓ ${envName}=${configured}`);
      console.log(`  → "${title}"; Status property type: ${statusProp ? (statusProp[1] as Json).type : "MISSING"}`);
    } catch (err) {
      console.log(`✗ ${envName}=${configured}`);
      console.log(`  → ${err instanceof Error ? err.message : err}`);
      console.log(`  → Check integration access in Notion → Connections, or find the right id above.`);
    }
  }

  // 3. Seed check: LinkedIn database id from the PRD
  console.log("\n=== LinkedIn database seed check ===\n");
  try {
    const db = await notion(`/databases/41ac05db-b314-46fb-af4e-aeba3404277e`);
    console.log(`Database "${(db.title ?? []).map((t: Json) => t.plain_text).join("")}"`);
    for (const ds of db.data_sources ?? []) {
      console.log(`  data source: ${ds.id} (${ds.name})`);
    }
  } catch (err) {
    console.log(`Could not fetch LinkedIn DB: ${err instanceof Error ? err.message : err}`);
  }

  console.log("\nDone. Paste any corrected ids into .env / Vercel env vars.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
