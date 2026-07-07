/**
 * Phase 11 — Notion -> twin-repo exporter (hermes-calibration-plan.md §4.5,
 * §8; build-brief.md "Phase 11 — Notion Exporter").
 *
 * Notion is the human source of truth for Isaac's identity (soul, constitution,
 * positions, platform workflows). The twin repo (`~/twin` on the Mac mini,
 * GitHub `isaacsplash18/hermes-context`) is the versioned, machine-readable
 * mirror Hermes actually reads. This script renders that mirror from live
 * Notion content — discovery-based, never invented.
 *
 * Usage:
 *   npx tsx scripts/export-twin-context.ts                 # dry-run (default)
 *   npx tsx scripts/export-twin-context.ts --dry-run        # same, explicit
 *   npx tsx scripts/export-twin-context.ts --target <path> --yes
 *       # writes into a REAL twin-repo checkout. Requires --yes. Backs up any
 *       # file it would overwrite to <path>/.export-backups/<timestamp>/ first.
 *
 *   npm run export:twin   # dry-run, writes to hermes/export-preview/
 *
 * This script:
 *   - only ever performs GET-style reads against Notion (queries, page reads,
 *     block reads, search). It never writes to Notion.
 *   - never invents a Notion page/database id. Every target file's source is
 *     either (a) discovered by walking the Constitution hub page's children
 *     (capped depth 3) and matching titles against a keyword list, or
 *     (b) discovered via Notion's /search endpoint scoped by the same
 *     keywords, accepted only if the *result's own title* contains one of the
 *     keywords (search-by-content noise is rejected). If neither finds a
 *     source, the target file is written as a documented, non-canonical stub.
 *   - never writes NOTION_TOKEN or any other env value into an output file.
 *   - never commits or pushes anything.
 */

import "dotenv/config";
import { mkdir, readFile, writeFile, stat, cp } from "fs/promises";
import path from "path";
import {
  notionFetch,
  queryDataSource,
  listBlocks,
  plainText,
  readTitle,
  readSelectProp,
  readRichTextProp,
} from "../lib/notion";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes("--target");
const TARGET_IDX = argv.indexOf("--target");
const TARGET_PATH = TARGET_IDX >= 0 ? argv[TARGET_IDX + 1] : undefined;
const YES = argv.includes("--yes");

if (!DRY_RUN && !YES) {
  console.error(
    "Refusing to write to --target without --yes. Run a --dry-run first, review " +
      "hermes/export-preview/, then re-run with --target <path> --yes."
  );
  process.exit(1);
}
if (!DRY_RUN && !TARGET_PATH) {
  console.error("--target requires a path.");
  process.exit(1);
}

const OUT_ROOT = DRY_RUN
  ? path.resolve(__dirname, "..", "hermes", "export-preview")
  : path.resolve(TARGET_PATH!);

const GENERATED_AT = new Date().toISOString();
const GENERATOR = "export-twin-context v1";

// ---------------------------------------------------------------------------
// Known-good coordinates (never invented; from the calibration plan / .env)
// ---------------------------------------------------------------------------

const CONSTITUTION_HUB_PAGE_ID = "3651fec9-ef83-811b-a9ec-f530474ec779";
const DS_POSITIONS = process.env.DS_POSITIONS;

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface DiscoveredPage {
  id: string;
  title: string;
  depth: number;
  kind: "child_page" | "child_database";
}

interface TargetSpec {
  key: string;
  /** First entry is the primary/exact phrase; rest are looser fallbacks. */
  titleContains: string[];
}

interface MatchResult {
  found: boolean;
  pageId?: string;
  title?: string;
  confidence?: "exact-title" | "keyword-search";
  via?: "hub-walk" | "notion-search";
  searched: string[];
}

const TARGETS: Record<string, TargetSpec> = {
  constitution: { key: "constitution", titleContains: ["personal constitution"] },
  constitution_changelog: {
    key: "constitution_changelog",
    titleContains: ["weekly review", "pending amendments"],
  },
  voice: { key: "voice", titleContains: ["brand voice guidelines"] },
  context: { key: "context", titleContains: ["context", "ventures", "goals and audience"] },
  workflow_x: {
    key: "workflow_x",
    titleContains: ["x workflow", "x daily tweet workflow", "twitter workflow"],
  },
  workflow_linkedin: { key: "workflow_linkedin", titleContains: ["linkedin workflow"] },
  workflow_ig_story: {
    key: "workflow_ig_story",
    titleContains: ["instagram story workflow", "ig story workflow"],
  },
  workflow_ig_carousel: {
    key: "workflow_ig_carousel",
    titleContains: ["instagram carousel workflow", "ig carousel workflow"],
  },
  workflow_substack: {
    key: "workflow_substack",
    titleContains: ["substack workflow", "larger workflow", "essay workflow"],
  },
};

/** Walk the Constitution hub's child pages/databases, capped at depth 3. */
async function walkHub(): Promise<DiscoveredPage[]> {
  const out: DiscoveredPage[] = [];
  async function recurse(pageId: string, depth: number): Promise<void> {
    if (depth > 3) return;
    const blocks = await listBlocks(pageId);
    for (const b of blocks) {
      if (b.type === "child_page") {
        const title = b.child_page?.title ?? "(untitled)";
        out.push({ id: b.id, title, depth, kind: "child_page" });
        await recurse(b.id, depth + 1);
      } else if (b.type === "child_database") {
        const title = b.child_database?.title ?? "(untitled)";
        out.push({ id: b.id, title, depth, kind: "child_database" });
      }
    }
  }
  await recurse(CONSTITUTION_HUB_PAGE_ID, 0);
  return out;
}

function titleMatches(title: string, phrase: string): boolean {
  return title.toLowerCase().includes(phrase.toLowerCase());
}

/** Match a target against the hub-walk results; exact-title = matches the primary phrase. */
function matchInHub(spec: TargetSpec, discovered: DiscoveredPage[]): MatchResult | null {
  for (const phrase of spec.titleContains) {
    const hit = discovered.find((d) => d.kind === "child_page" && titleMatches(d.title, phrase));
    if (hit) {
      return {
        found: true,
        pageId: hit.id,
        title: hit.title,
        confidence: phrase === spec.titleContains[0] ? "exact-title" : "keyword-search",
        via: "hub-walk",
        searched: [phrase],
      };
    }
  }
  return null;
}

/** Fall back to Notion /search, scoped by title keywords, rejecting content-only matches. */
async function matchViaSearch(spec: TargetSpec): Promise<MatchResult> {
  const searched: string[] = [];
  for (const phrase of spec.titleContains) {
    searched.push(phrase);
    const resp = await notionFetch("/search", {
      method: "POST",
      body: JSON.stringify({
        query: phrase,
        filter: { property: "object", value: "page" },
        page_size: 10,
      }),
    });
    for (const r of resp.results ?? []) {
      const title = readTitle(r);
      if (title && titleMatches(title, phrase)) {
        return {
          found: true,
          pageId: r.id,
          title,
          confidence: phrase === spec.titleContains[0] ? "exact-title" : "keyword-search",
          via: "notion-search",
          searched,
        };
      }
    }
  }
  return { found: false, searched };
}

async function discoverTarget(spec: TargetSpec, hubResults: DiscoveredPage[]): Promise<MatchResult> {
  const hubHit = matchInHub(spec, hubResults);
  if (hubHit) return hubHit;
  return matchViaSearch(spec);
}

// ---------------------------------------------------------------------------
// Block -> Markdown conversion (paragraphs, headings 1-3, bulleted/numbered
// lists, quotes, dividers, code blocks; everything else -> inline comment).
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function richTextToMd(rt: Json[] | undefined): string {
  return (rt ?? [])
    .map((t) => {
      let s: string = t.plain_text ?? "";
      const a = t.annotations ?? {};
      if (a.code) s = `\`${s}\``;
      if (a.bold) s = `**${s}**`;
      if (a.italic) s = `*${s}*`;
      if (a.strikethrough) s = `~~${s}~~`;
      if (t.href) s = `[${s}](${t.href})`;
      return s;
    })
    .join("");
}

const SUPPORTED_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "quote",
  "divider",
  "code",
]);

/**
 * Source-quality guard: some Notion pages in this workspace store an entire
 * section as one oversized paragraph block (a paste/import artifact,
 * observed on "Brand Voice Guidelines" — literal "n"/"nn" characters where
 * line breaks were clearly intended, not real newlines). The exporter never
 * rewrites Isaac's text to "fix" this — that would be inventing structure —
 * but it does flag it inline so a human reviewing the dry-run output knows
 * to go fix the source page rather than trust the rendered shape here.
 */
const LARGE_BLOCK_THRESHOLD = 1500;

function sizeWarning(rawLen: number, blockType: string): string | null {
  if (rawLen <= LARGE_BLOCK_THRESHOLD) return null;
  return (
    `<!-- source-quality warning: this ${blockType} block is ${rawLen} chars, unusually ` +
    `large for a single Notion block. It may contain literal "n"/"nn" characters where ` +
    `line breaks were intended (a paste/import artifact) rather than real newlines. The ` +
    `exporter mirrors the source verbatim and does not invent line breaks — fix at the ` +
    `Notion source if this reads as garbled. -->`
  );
}

/** Render one rich-text-bearing block, prefixing a size warning when the raw text is oversized. */
function renderTextBlock(blockType: string, rawRichText: Json[] | undefined, wrap: (md: string) => string): string[] {
  const raw = plainText(rawRichText);
  if (!raw.trim()) return [];
  const md = richTextToMd(rawRichText);
  const out: string[] = [];
  const warning = sizeWarning(raw.length, blockType);
  if (warning) out.push(warning);
  out.push(wrap(md));
  return out;
}

async function renderBlocks(pageId: string, depth = 0, maxDepth = 4): Promise<string> {
  const blocks = await listBlocks(pageId);
  const lines: string[] = [];
  for (const b of blocks) {
    const indent = "  ".repeat(Math.max(0, depth - 1));
    switch (b.type) {
      case "paragraph":
        lines.push(...renderTextBlock("paragraph", b.paragraph?.rich_text, (md) => md));
        break;
      case "heading_1":
        lines.push(...renderTextBlock("heading_1", b.heading_1?.rich_text, (md) => `# ${md}`));
        break;
      case "heading_2":
        lines.push(...renderTextBlock("heading_2", b.heading_2?.rich_text, (md) => `## ${md}`));
        break;
      case "heading_3":
        lines.push(...renderTextBlock("heading_3", b.heading_3?.rich_text, (md) => `### ${md}`));
        break;
      case "bulleted_list_item":
        lines.push(
          ...renderTextBlock("bulleted_list_item", b.bulleted_list_item?.rich_text, (md) => `${indent}- ${md}`)
        );
        break;
      case "numbered_list_item":
        lines.push(
          ...renderTextBlock("numbered_list_item", b.numbered_list_item?.rich_text, (md) => `${indent}1. ${md}`)
        );
        break;
      case "quote":
        lines.push(...renderTextBlock("quote", b.quote?.rich_text, (md) => `> ${md}`));
        break;
      case "divider":
        lines.push(`---`);
        break;
      case "code": {
        const lang = b.code?.language ?? "";
        const code = plainText(b.code?.rich_text);
        const warning = sizeWarning(code.length, "code");
        if (warning) lines.push(warning);
        lines.push(`\`\`\`${lang}\n${code}\n\`\`\``);
        break;
      }
      default:
        lines.push(`<!-- unsupported block type: ${b.type} -->`);
        break;
    }
    if (b.has_children && SUPPORTED_TYPES.has(b.type) && depth < maxDepth) {
      const child = await renderBlocks(b.id, depth + 1, maxDepth);
      if (child.trim()) lines.push(child);
    }
  }
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function yamlString(v: string): string {
  // Quote defensively if the value contains characters that would break bare YAML.
  if (/[:#{}[\],&*!|>'"%@`]/.test(v) || v.trim() !== v) {
    return JSON.stringify(v);
  }
  return v;
}

function buildFrontmatter(fields: Record<string, string | number>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`${k}: ${typeof v === "number" ? v : yamlString(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function okFrontmatter(opts: { name: string; title: string; sourceLabel: string; sourcePageId?: string }): string {
  return buildFrontmatter({
    name: opts.name,
    title: opts.title,
    generated: GENERATED_AT,
    generator: GENERATOR,
    status: "ok",
    source: opts.sourceLabel,
    ...(opts.sourcePageId ? { source_page_id: opts.sourcePageId } : {}),
  });
}

function stubFrontmatter(opts: { name: string; reason: string; searched: string[] }): string {
  const lines = [
    "---",
    `name: ${opts.name}`,
    `status: stub`,
    `reason: ${yamlString(opts.reason)}`,
    `generated: ${GENERATED_AT}`,
    `generator: ${GENERATOR}`,
    `searched:`,
    ...opts.searched.map((s) => `  - ${yamlString(s)}`),
    "---",
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Output collection
// ---------------------------------------------------------------------------

interface OutputFile {
  relPath: string;
  content: string;
  status: "ok" | "stub";
}

const outputs: OutputFile[] = [];

function addOutput(relPath: string, content: string, status: "ok" | "stub") {
  outputs.push({ relPath, content, status });
}

function stubContent(name: string, targetFileLabel: string, match: MatchResult): string {
  const fm = stubFrontmatter({
    name,
    reason: "no Notion source located",
    searched: match.searched,
  });
  return (
    fm +
    `This is a documented stub for \`${targetFileLabel}\`. No Notion page title matched ` +
    `any of the searched terms above (hub walk + Notion search, both title-scoped). ` +
    `Nothing was invented. See hermes/runbooks/notion-exporter.md for how to resolve this ` +
    `(point the exporter at the correct page, or confirm the source doesn't exist yet).\n`
  );
}

// ---------------------------------------------------------------------------
// Positions Library (fully buildable; per calibration-plan §4.1 / build-brief)
// ---------------------------------------------------------------------------

async function buildPositionsPack(): Promise<{ content: string; status: "ok" | "stub" }> {
  if (!DS_POSITIONS) {
    return {
      status: "stub",
      content: stubContent("positions", "packs/positions.md", {
        found: false,
        searched: ["env DS_POSITIONS is unset"],
      }),
    };
  }
  const rows = await queryDataSource(DS_POSITIONS, {});
  const groups: Record<string, Json[]> = { Active: [], "Needs validation": [], Retired: [] };
  for (const r of rows) {
    const status = readSelectProp(r, "Status") ?? "Active";
    if (!groups[status]) groups[status] = [];
    groups[status].push(r);
  }

  const lines: string[] = [];
  for (const [status, items] of Object.entries(groups)) {
    if (!items.length) continue;
    lines.push(`## ${status} (${items.length})`);
    lines.push("");
    for (const item of items) {
      const title = readTitle(item);
      const confidence = readSelectProp(item, "Confidence") ?? "(unset)";
      const lastValidated = item.properties?.["Last validated"]?.date?.start ?? "(never)";
      lines.push(`### ${title}`);
      lines.push("");
      lines.push(`- **Confidence:** ${confidence}`);
      lines.push(`- **Last validated:** ${lastValidated}`);
      const basis = readRichTextProp(item, "Basis");
      if (basis) lines.push(`- **Basis:** ${basis}`);
      const nuance = readRichTextProp(item, "Nuance");
      if (nuance) lines.push(`- **Nuance:** ${nuance}`);
      const question = readRichTextProp(item, "Question");
      if (question) lines.push(`- **Question:** ${question}`);
      const articles = readRichTextProp(item, "Articles");
      if (articles) lines.push(`- **Articles:** ${articles}`);
      lines.push("");
    }
  }

  const total = rows.length;
  const counts = Object.entries(groups)
    .filter(([, v]) => v.length)
    .map(([k, v]) => `${k.toLowerCase().replace(/ /g, "_")}: ${v.length}`)
    .join(", ");

  const fm = buildFrontmatter({
    name: "positions",
    title: "Positions Library",
    generated: GENERATED_AT,
    source: "notion/positions-library",
    generator: GENERATOR,
    status: "ok",
    total_positions: total,
    counts_by_status: counts,
  });

  return { status: "ok", content: fm + `# Positions Library\n\n` + lines.join("\n") + "\n" };
}

// ---------------------------------------------------------------------------
// Page-based export helper
// ---------------------------------------------------------------------------

async function buildPageExport(opts: {
  name: string;
  title: string;
  targetFileLabel: string;
  match: MatchResult;
  extraNote?: string;
  appendix?: { heading: string; pageId: string; title: string };
}): Promise<{ content: string; status: "ok" | "stub" }> {
  if (!opts.match.found || !opts.match.pageId) {
    return { status: "stub", content: stubContent(opts.name, opts.targetFileLabel, opts.match) };
  }
  const body = await renderBlocks(opts.match.pageId);
  const fm = okFrontmatter({
    name: opts.name,
    title: opts.match.title ?? opts.title,
    sourceLabel: `notion/page/${opts.match.title}`,
    sourcePageId: opts.match.pageId,
  });
  let content = fm + `# ${opts.match.title}\n\n`;
  if (opts.extraNote) content += `> ${opts.extraNote}\n\n`;
  content += body.trim() + "\n";

  if (opts.appendix) {
    const appendixBody = await renderBlocks(opts.appendix.pageId);
    content += `\n\n## ${opts.appendix.heading}\n\n`;
    content += `*Source: Notion page "${opts.appendix.title}" (${opts.appendix.pageId}).*\n\n`;
    content += appendixBody.trim() + "\n";
  }

  return { status: "ok", content };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`export-twin-context — ${DRY_RUN ? "DRY RUN" : `TARGET MODE (${OUT_ROOT})`}`);
  console.log(`generated: ${GENERATED_AT}\n`);

  console.log("=== Discovery ===\n");
  console.log(`Walking Constitution hub (${CONSTITUTION_HUB_PAGE_ID}), depth <= 3...`);
  const hubResults = await walkHub();
  console.log(`Found ${hubResults.length} child pages/databases under the hub.\n`);

  const matches: Record<string, MatchResult> = {};
  for (const [key, spec] of Object.entries(TARGETS)) {
    matches[key] = await discoverTarget(spec, hubResults);
    const m = matches[key];
    if (m.found) {
      console.log(
        `  FOUND   ${key.padEnd(22)} -> "${m.title}" (${m.pageId}) [${m.confidence}, via ${m.via}]`
      );
    } else {
      console.log(`  NOT FOUND ${key.padEnd(20)} -> searched: ${m.searched.join(" | ")}`);
    }
  }

  // Informational only — Knowledge Wiki DB presence, not wired to a specific
  // target file in v1 (context.md's true source could not be located; see
  // the `context` match above, which is independent of this DB).
  if (process.env.DS_WIKI) {
    console.log(`  INFO    knowledge_wiki DB configured (DS_WIKI=${process.env.DS_WIKI}) — not exported in v1.`);
  }

  console.log("\n=== Building exports ===\n");

  // soul.md / packs/voice.md <- Brand Voice Guidelines page
  const voiceCurated = await buildPageExport({
    name: "soul",
    title: "Isaac Ho - Soul (how he communicates / voice)",
    targetFileLabel: "soul.md",
    match: matches.voice,
    extraNote:
      "This is a raw mechanical mirror of the discovered Notion source page (full block " +
      "text), not the hand-curated short distillation the canonical soul.md carries. " +
      "Producing that distillation requires editorial judgment this exporter does not " +
      "perform. Review before treating as the always-loaded voice file.",
  });
  addOutput("soul.md", voiceCurated.content, voiceCurated.status);

  const voiceFull = await buildPageExport({
    name: "voice",
    title: "Full Brand Voice",
    targetFileLabel: "packs/voice.md",
    match: matches.voice,
  });
  addOutput("packs/voice.md", voiceFull.content, voiceFull.status);

  // constitution.md / packs/constitution-full.md <- Isaac's Personal Constitution page
  const constitutionCurated = await buildPageExport({
    name: "constitution",
    title: "Isaac Ho - Constitution (how he functions as a human)",
    targetFileLabel: "constitution.md",
    match: matches.constitution,
    extraNote:
      "This is a raw mechanical mirror of the discovered Notion source page (full block " +
      "text), not the hand-curated short distillation the canonical constitution.md " +
      "carries. Producing that distillation requires editorial judgment this exporter " +
      "does not perform. Review before treating as the always-loaded constitution file.",
  });
  addOutput("constitution.md", constitutionCurated.content, constitutionCurated.status);

  const constitutionFull = await buildPageExport({
    name: "constitution-full",
    title: "Full Constitution",
    targetFileLabel: "packs/constitution-full.md",
    match: matches.constitution,
    appendix: matches.constitution_changelog.found
      ? {
          heading: "Weekly Review & Pending Amendments",
          pageId: matches.constitution_changelog.pageId!,
          title: matches.constitution_changelog.title!,
        }
      : undefined,
  });
  addOutput("packs/constitution-full.md", constitutionFull.content, constitutionFull.status);

  // context.md <- no reliable source found; stub
  addOutput(
    "context.md",
    stubContent("context", "context.md", matches.context),
    matches.context.found ? "ok" : "stub"
  );
  if (matches.context.found) {
    // Handled generically below in case a future workspace does have a Context page.
    const contextExport = await buildPageExport({
      name: "context",
      title: "Isaac Ho - Context (ventures, audience, goals)",
      targetFileLabel: "context.md",
      match: matches.context,
    });
    outputs[outputs.length - 1] = { relPath: "context.md", content: contextExport.content, status: contextExport.status };
  }

  // packs/positions.md <- DS_POSITIONS (always buildable per spec)
  const positions = await buildPositionsPack();
  addOutput("packs/positions.md", positions.content, positions.status);

  // packs/workflows/*.md
  const workflowMap: Array<{ file: string; matchKey: string; name: string; title: string }> = [
    { file: "packs/workflows/x.md", matchKey: "workflow_x", name: "x-workflow", title: "X Workflow" },
    { file: "packs/workflows/linkedin.md", matchKey: "workflow_linkedin", name: "linkedin-workflow", title: "LinkedIn Workflow" },
    { file: "packs/workflows/ig-story.md", matchKey: "workflow_ig_story", name: "ig-story-workflow", title: "Instagram Story Workflow" },
    { file: "packs/workflows/ig-carousel.md", matchKey: "workflow_ig_carousel", name: "ig-carousel-workflow", title: "Instagram Carousel Workflow" },
    { file: "packs/workflows/substack.md", matchKey: "workflow_substack", name: "substack-workflow", title: "Substack Workflow" },
  ];
  for (const w of workflowMap) {
    const result = await buildPageExport({
      name: w.name,
      title: w.title,
      targetFileLabel: w.file,
      match: matches[w.matchKey],
    });
    addOutput(w.file, result.content, result.status);
  }

  // ---------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------

  console.log(`\n=== Writing ${outputs.length} files to ${OUT_ROOT} ===\n`);

  // Files whose existing copy could NOT be backed up — never overwritten.
  const skippedForBackup = new Set<string>();
  if (!DRY_RUN) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(OUT_ROOT, ".export-backups", timestamp);
    let backedUp = 0;
    for (const o of outputs) {
      const dest = path.join(OUT_ROOT, o.relPath);
      let exists = true;
      try {
        await stat(dest);
      } catch (err) {
        // ONLY a genuine "file not there" (ENOENT) means nothing to back up.
        // Any other stat error is a real failure — do not overwrite unbacked.
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          exists = false;
        } else {
          skippedForBackup.add(o.relPath);
          console.error(
            `  BACKUP FAILED (stat) — ${o.relPath}: ${err instanceof Error ? err.message : String(err)} — will NOT overwrite`
          );
          continue;
        }
      }
      if (!exists) continue; // nothing to back up; the write loop creates it fresh
      try {
        await mkdir(path.dirname(path.join(backupDir, o.relPath)), { recursive: true });
        await cp(dest, path.join(backupDir, o.relPath));
        backedUp++;
      } catch (err) {
        // The file exists but could not be copied — never overwrite a
        // canonical file without a backup. Skip its write and report it.
        skippedForBackup.add(o.relPath);
        console.error(
          `  BACKUP FAILED (cp) — ${o.relPath}: ${err instanceof Error ? err.message : String(err)} — will NOT overwrite`
        );
      }
    }
    if (backedUp > 0) {
      console.log(`Backed up ${backedUp} existing file(s) to ${backupDir}\n`);
    }
    if (skippedForBackup.size > 0) {
      console.error(`${skippedForBackup.size} file(s) could not be backed up and will NOT be overwritten:`);
      for (const rel of skippedForBackup) console.error(`  - ${rel}`);
      console.error("");
    }
  }

  for (const o of outputs) {
    if (skippedForBackup.has(o.relPath)) {
      console.log(`  SKIPPED (backup failed) ${o.relPath}`);
      continue;
    }
    const dest = path.join(OUT_ROOT, o.relPath);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, o.content, "utf8");
    console.log(`  wrote ${o.status === "stub" ? "[STUB] " : "       "}${o.relPath}`);
  }

  // ---------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------

  console.log(`\n=== Validation ===\n`);
  let failures = 0;
  let stubCount = 0;
  for (const o of outputs) {
    if (skippedForBackup.has(o.relPath)) {
      console.log(`  SKIP — ${o.relPath} (not written; existing file could not be backed up)`);
      continue;
    }
    const dest = path.join(OUT_ROOT, o.relPath);
    const buf = await readFile(dest, "utf8");
    const exists = buf.length > 0;
    const hasFrontmatter = buf.startsWith("---\n") && buf.indexOf("\n---\n", 4) > 0;
    if (o.status === "stub") {
      stubCount++;
      const ok = exists && hasFrontmatter;
      console.log(`  ${ok ? "PASS" : "FAIL"} — ${o.relPath} (stub, ${buf.length} bytes, frontmatter=${hasFrontmatter})`);
      if (!ok) failures++;
    } else {
      const bigEnough = buf.length > 200;
      const ok = exists && hasFrontmatter && bigEnough;
      console.log(
        `  ${ok ? "PASS" : "FAIL"} — ${o.relPath} (${buf.length} bytes, frontmatter=${hasFrontmatter}, >200B=${bigEnough})`
      );
      if (!ok) failures++;
    }
  }

  console.log(
    `\n${outputs.length} files total, ${stubCount} stub(s), ${outputs.length - stubCount} real export(s), ${failures} failure(s)${
      skippedForBackup.size > 0 ? `, ${skippedForBackup.size} skipped (backup failed)` : ""
    }.`
  );

  if (failures > 0 || skippedForBackup.size > 0) {
    if (skippedForBackup.size > 0) {
      console.error(
        `\n${skippedForBackup.size} file(s) were NOT written because their existing copy could not be backed up.`
      );
    }
    if (failures > 0) {
      console.error("\nVALIDATION FAILED — a non-stub file came out empty or malformed.");
    }
    process.exit(1);
  }
  console.log("\nValidation passed (stubs are allowed — they are honest).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
