# Notion -> Twin Repo Exporter Runbook

*Companion to `docs/hermes-calibration-plan.md` §4.5 (last bullet) and §8, and
`docs/build-brief.md` "Phase 11 — Notion Exporter". Covers
`scripts/export-twin-context.ts`.*

## What this is

Notion is the human source of truth for Isaac's identity content (soul/voice,
constitution, positions, platform workflows). The twin repo
(`isaacsplash18/hermes-context`, checked out at `~/twin` on the Mac mini) is
the versioned, machine-readable mirror Hermes actually reads every 30
minutes. This script renders that mirror from live Notion content.

It is **discovery-based, never invented**: every exported file's source is
either found by walking the Constitution hub page's children, found via a
title-scoped Notion search, or — if neither locates a source — the file is
written as a documented, clearly non-canonical **stub**. The script never
guesses a page id and never fabricates content.

## How to run

```bash
# Dry run (default). Writes only to hermes/export-preview/ in this repo.
npm run export:twin
npx tsx scripts/export-twin-context.ts
npx tsx scripts/export-twin-context.ts --dry-run   # same, explicit

# Target mode. Writes into a REAL twin-repo checkout. Requires --yes.
npx tsx scripts/export-twin-context.ts --target /path/to/twin --yes
```

- **Dry-run is the default and the only mode this phase actually exercised.**
  `--target` without `--yes` refuses to run and tells you to review a
  dry-run first.
- The script only performs read (`GET`/query) calls against Notion. It never
  writes to Notion, never commits, and never pushes to git — that stays a
  human/orchestrator action.
- It never writes `NOTION_TOKEN` or any other env value into an output file.

## What it exports

Eleven target files, matching the build brief:

```
soul.md
constitution.md
context.md
packs/voice.md
packs/positions.md
packs/constitution-full.md
packs/workflows/x.md
packs/workflows/linkedin.md
packs/workflows/ig-story.md
packs/workflows/ig-carousel.md
packs/workflows/substack.md
```

## Discovery model

1. **Hub walk.** Starting from the Constitution hub page
   (`3651fec9-ef83-811b-a9ec-f530474ec779`, "Personal Constitution"), the
   script recursively lists block children (`listBlocks`) down to depth 3,
   collecting every `child_page` and `child_database` it finds (title + id).
2. **Title match.** Each target has a small ordered list of title keywords
   (e.g. constitution: `["personal constitution"]`; ig-story workflow:
   `["instagram story workflow", "ig story workflow"]`). A hub-walk result
   whose title contains the *first* (primary) keyword is `exact-title`
   confidence; a match on a secondary keyword is `keyword-search` confidence.
3. **Search fallback.** If the hub walk finds nothing, the script calls
   Notion's `/search` endpoint (`filter: { property: "object", value: "page"
   }`) once per keyword, but **only accepts a result if the result's own
   page title contains the keyword** — Notion's search also matches on page
   *content*, which is far too noisy to trust blindly (verified: searching
   "LinkedIn Workflow" surfaces several unrelated pages whose body happens to
   mention LinkedIn). Content-only matches are rejected, not silently
   accepted.
4. If neither step finds a source, the target is `NOT FOUND` and every file
   depending on it is written as a stub.

### What this run actually found (2026-07-07, live Notion)

| Target | Result | Source | Confidence |
|---|---|---|---|
| constitution | FOUND | "Isaac's Personal Constitution (v1)" | exact-title, hub-walk |
| constitution changelog (appendix only) | FOUND | "Constitution — Weekly Review & Pending Amendments" | exact-title, hub-walk |
| voice/soul | FOUND | "Brand Voice Guidelines — Isaac Ho / \"Larger\"" | exact-title, hub-walk |
| context | NOT FOUND | — | — |
| workflow: x | NOT FOUND | — | — |
| workflow: linkedin | NOT FOUND | — | — |
| workflow: ig-story | FOUND | "Instagram Story Workflow" | exact-title, hub-walk |
| workflow: ig-carousel | FOUND | "Instagram Carousel Workflow" | exact-title, hub-walk |
| workflow: substack | NOT FOUND | — | — |

`context.md`, `packs/workflows/x.md`, `packs/workflows/linkedin.md`, and
`packs/workflows/substack.md` are stubs as of this run because no Notion page
title matches. This is a workspace-content gap, not a script bug — see
`docs/changelogs/phase-11.md` for the full discovery report and how to
resolve it (create/rename the relevant Notion pages, or point the exporter at
different keywords if the source already exists under an unexpected title).

## Block -> markdown conversion

Supported Notion block types: `paragraph`, `heading_1/2/3`,
`bulleted_list_item`, `numbered_list_item`, `quote`, `divider`, `code`.
Anything else (callout, image, table, toggle, to_do, embed, etc.) is skipped
and replaced with an inline HTML comment: `<!-- unsupported block type: X -->`
so the gap is visible in the output rather than silently dropped.

**Source-quality guard:** the "Brand Voice Guidelines" page stores most of
its body as a single oversized `heading_1` block (~9.5k characters) whose
plain text contains literal `n`/`nn` characters where line breaks were
clearly intended — a paste/import artifact predating this exporter, not
something the script introduced. The exporter **never rewrites Isaac's text
to "fix" this** (that would be inventing structure that isn't actually in
Notion); it mirrors the block verbatim and prepends a `<!--
source-quality warning: ... -->` comment whenever a rendered block exceeds
1500 characters, so a human reviewing the dry-run knows to go split that
block up at the Notion source rather than trust the rendered shape. This
showed up in `soul.md` and `packs/voice.md` this run; `constitution.md`,
`packs/constitution-full.md`, and both IG workflow files came back clean
(properly separated Notion blocks, no warnings).

## Stub semantics

A stub file is a real file (non-empty, valid frontmatter) that plainly says
it isn't a real export:

```yaml
---
name: x-workflow
status: stub
reason: no Notion source located
generated: <ISO timestamp>
generator: export-twin-context v1
searched:
  - x workflow
  - x daily tweet workflow
  - twitter workflow
---
```

Stubs are **allowed to pass validation** — an honest "I couldn't find this"
is the correct output when the source genuinely doesn't exist yet, and is far
better than a script that invents plausible-looking content. Validation only
fails the run if a **non-stub** file comes out empty or malformed (frontmatter
missing, or under 200 bytes) — that would indicate a real bug, not a
discovery gap.

## Frontmatter shape

The real twin repo's hand-authored files (studied in the reference clone
before writing this script) carry a richer frontmatter than this exporter
produces — fields like `owner`, `maps_to`, `pairs_with`, `consumes`, `load`
encode Isaac's own editorial intent about how Hermes should use each file,
and a mechanical exporter has no honest way to infer those. This script's
frontmatter is deliberately smaller and is exporter-generated metadata, not a
drop-in replacement for the curated fields:

```yaml
---
name: <slug>
title: <Notion page title, when a real source was found>
generated: <ISO timestamp of this export run>
generator: export-twin-context v1
status: ok | stub
source: notion/page/<title> | notion/positions-library
source_page_id: <Notion page id>   # ok files only
---
```

**A human (or a later phase) applying a dry-run export to the real twin repo
should merge this generated frontmatter into the existing hand-authored
frontmatter, not blindly overwrite it.** `--target` mode's automatic backup
(below) exists precisely so nothing is lost if that merge is done wrong the
first time.

## `soul.md` and `constitution.md`: known limitation, read before using

The canonical twin repo's `soul.md` and `constitution.md` are **short, hand-
curated distillations** ("Identity in one paragraph", "Hard rules", "The
Articles") — not a raw dump of the Notion source page. Producing that
distillation is editorial work (summarising, selecting, compressing) that
this mechanical, deterministic exporter deliberately does not attempt, because
doing so would mean generating text that is not literally present in Notion —
exactly the kind of invention the brief prohibits.

So in this exporter, `soul.md` and `constitution.md` are the **full raw
block-rendered text of the discovered source page**, identical in substance
to `packs/voice.md` / `packs/constitution-full.md`, with an explicit
frontmatter/inline note saying so. **Do not point `--target` at a real twin
repo and let this overwrite the hand-curated `soul.md`/`constitution.md`
without a human rewriting them back down to the short form** — that is
exactly the kind of accidental canonical-file clobber the backup step and
this note exist to prevent. Treat these two specific output files as raw
material for a human/Hermes to re-condense, not as ready-to-ship replacements.

## Backups (`--target` mode only)

Before writing any file that already exists at the destination path, the
script copies it to
`<target>/.export-backups/<ISO-timestamp-with-dashes>/<relative-path>`,
preserving the full relative path so nothing overwrites a previous backup.
Dry-run mode never touches an existing directory outside
`hermes/export-preview/`, so there is nothing to back up there.

## Validation

Runs automatically at the end of every invocation, both modes:

- Every one of the 11 target files exists in the output directory.
- Non-stub files: non-empty, over 200 bytes, and start with a well-formed
  `---\n ... \n---\n` frontmatter block.
- Stub files: non-empty and have well-formed frontmatter (their existence and
  shape is checked; their honesty about being a stub is exactly the point).
- Prints `PASS`/`FAIL` per file, then a summary line (`N files total, N
  stub(s), N real export(s), N failure(s)`).
- Exit code: `1` if any **non-stub** file failed validation (indicates a real
  bug); `0` otherwise, including when stubs are present.

## Review protocol before ever using `--target`

**Never run `--target` against a real twin repo checkout (`~/twin` or a local
clone of `hermes-context`) without first reviewing a dry-run diff.**

1. Run `npm run export:twin` (dry-run). Read the discovery report in the
   console output — confirm every `FOUND` line points at the page you'd
   expect, and note every `NOT FOUND` line.
2. Diff `hermes/export-preview/` against the real twin repo checkout by hand
   (or `diff -ru`). Pay special attention to:
   - `soul.md` / `constitution.md` — these will look completely different
     from the curated versions (see the limitation above). Do not copy them
     over verbatim.
   - Any file carrying a `source-quality warning` HTML comment — go fix the
     Notion source block before trusting the rendered shape.
   - Any stub — confirm whether the source genuinely doesn't exist yet, or
     whether the exporter's keyword list just missed a real page (in which
     case, extend `TARGETS` in `scripts/export-twin-context.ts` rather than
     hand-editing the stub).
3. Only after that review, and only with explicit human sign-off, run
   `--target <path> --yes`. Immediately check the printed "Backed up N
   existing file(s) to ..." line and confirm the backup directory exists
   before trusting the overwrite.
4. This script **never commits or pushes**. Committing/pushing the result to
   `isaacsplash18/hermes-context` (on a branch, never `main` per the
   calibration plan) stays a separate, explicit, human/orchestrator-gated
   step.

## Known limitations

- `context.md` has no discovered Notion source in this workspace as of this
  run — it is a stub. The reference clone's `context.md` (ventures, audience,
  goals) doesn't correspond to any single Notion page found by hub-walk or
  search; it may need a dedicated Notion page created, or a future version of
  this script may need to compose it from multiple sources (Notion search for
  "Context"/"Ventures"/"Goals and Audience" all returned nothing on this run).
- `packs/workflows/x.md`, `linkedin.md`, and `substack.md` are stubs — no
  Notion page titled anything like "X Workflow" / "LinkedIn Workflow" /
  "Substack Workflow" exists in the workspace as of this run, even though
  local reference markdown for some of these exists at
  `/Users/isaacho/Documents/Claude/Projects/AI Constitution/` (not a Notion
  source, so not used — the brief's source of truth for this exporter is
  Notion only).
- Block conversion only covers 8 block types (see above); anything richer
  (tables, images, callouts, toggles) degrades to an inline "unsupported"
  comment rather than being rendered.
- List nesting recursion is capped at 4 levels (`maxDepth` in
  `renderBlocks`) to bound Notion API calls; deeper nesting is truncated
  silently past that (rare in this workspace's content, not observed in this
  run).
- `packs/positions.md` reads `Basis`/`Nuance`/`Question`/`Articles` as
  `rich_text` properties defensively (`readRichTextProp` returns `""` if a
  property is absent or a different type) — a schema change on the Positions
  Library data source degrades gracefully to omitted lines, not a crash.
- The exporter's frontmatter schema is intentionally smaller than the real
  twin repo's hand-authored frontmatter (see above) — this is a documented
  design choice, not an oversight.

## Rollback

- Dry-run mode only ever touches `hermes/export-preview/` in this repo — delete
  that directory (or `git checkout` it, since it's tracked) to remove all
  trace of a run.
- `--target` mode's backups live under `<target>/.export-backups/<timestamp>/`
  — restore any overwritten file from there.
- This script has no Notion-side state and makes no Notion writes, so there
  is nothing to roll back on the Notion side, ever.
