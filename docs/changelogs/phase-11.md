# Phase 11 — Notion Exporter

*Companion to `docs/hermes-calibration-plan.md` §4.5 (last bullet) and §8, and
`docs/build-brief.md` "Phase 11 — Notion Exporter". Full operating docs:
`hermes/runbooks/notion-exporter.md`.*

## Files changed

- `scripts/export-twin-context.ts` (new) — the exporter. `--dry-run` (default,
  writes to `hermes/export-preview/`) and `--target <path> --yes` (writes into
  a real twin-repo checkout, backing up any file it would overwrite to
  `<path>/.export-backups/<timestamp>/` first). Read-only against Notion
  (queries/page reads/block reads/search only — no Notion writes, ever). No
  git commit/push. Imports `lib/notion.ts` read-only
  (`notionFetch`, `queryDataSource`, `listBlocks`, `plainText`, `readTitle`,
  `readSelectProp`, `readRichTextProp`) and `dotenv/config`, matching
  `scripts/discover.ts` conventions.
- `hermes/export-preview/**` (new) — this run's dry-run output, 11 files (see
  below). Committed to the repo per the calibration plan (§4.5 / §5 P11 note:
  "committed as preview — committed, it's not secret").
- `hermes/runbooks/notion-exporter.md` (new) — how to run, discovery model and
  its limits, block conversion coverage, stub semantics, frontmatter shape,
  the `soul.md`/`constitution.md` raw-vs-curated limitation, backup behaviour,
  the mandatory dry-run-review-before-`--target` protocol, known limitations,
  rollback.
- `package.json` — added `"export:twin": "tsx scripts/export-twin-context.ts"`
  (re-read the file immediately before editing per the parallel-batch rule;
  another agent had already added `verify:draft-bridge` since this task
  started — added only the one new line, alongside it).
- this doc (new).

**Not touched:** middleware, `lib/` (read-only import only), `app/`,
`components/`, `scripts/migrate.ts`, `docs/hermes-calibration-plan.md`,
`docs/hermes-integration.md`, `hermes/README.md`, `hermes/scripts/`,
`hermes/.env.example`. No `npx next build`, no `npm run migrate`, no git
commands, no dev servers were run.

## Discovery report (this run, live Notion, read-only)

Walked the Constitution hub page (`3651fec9-ef83-811b-a9ec-f530474ec779`,
titled "Personal Constitution"), depth capped at 3 — found 58 child
pages/databases. Matched against a title-keyword list per target, with a
Notion `/search` fallback (title-scoped: only accepted a search hit whose own
title contains the searched keyword, to reject Notion's noisy content-match
search results).

| Target | Result | Matched Notion page | Confidence |
|---|---|---|---|
| `constitution.md` / `packs/constitution-full.md` | **FOUND** | "Isaac's Personal Constitution (v1)" (`36a1fec9-ef83-81b6-b9a6-fe6a614e9795`) | exact-title, hub-walk |
| constitution changelog appendix | **FOUND** | "Constitution — Weekly Review & Pending Amendments" (`36a1fec9-ef83-8118-86ed-c5876509f6fb`) | exact-title, hub-walk |
| `soul.md` / `packs/voice.md` | **FOUND** | "Brand Voice Guidelines — Isaac Ho / \"Larger\"" (`36b1fec9-ef83-8161-a982-f1186919cbe8`) | exact-title, hub-walk |
| `context.md` | **NOT FOUND** | — searched: context, ventures, goals and audience | — |
| `packs/positions.md` | **FOUND** (data source, not a page) | `DS_POSITIONS` env (`fd5f9efb-721d-40b5-b932-bf198e88f953`) | canonical env id, per brief |
| `packs/workflows/x.md` | **NOT FOUND** | — searched: x workflow, x daily tweet workflow, twitter workflow | — |
| `packs/workflows/linkedin.md` | **NOT FOUND** | — searched: linkedin workflow | — |
| `packs/workflows/ig-story.md` | **FOUND** | "Instagram Story Workflow" (`36d1fec9-ef83-8158-a4d2-f8e11cfcdeda`) | exact-title, hub-walk |
| `packs/workflows/ig-carousel.md` | **FOUND** | "Instagram Carousel Workflow" (`36e1fec9-ef83-819b-8eaf-e9e9ed764e1b`) | exact-title, hub-walk |
| `packs/workflows/substack.md` | **NOT FOUND** | — searched: substack workflow, larger workflow, essay workflow | — |

Informational: `DS_WIKI` ("Knowledge Wiki" data source) is configured but not
wired to any of the 11 export targets in this version — `context.md`'s true
source could not be located independently of it.

No Notion id was invented anywhere in this run — every `FOUND` row above
resolved through the hub walk (real Notion API responses), and every `NOT
FOUND` row was independently re-checked via `/search` and rejected only
because no returned page's own title matched.

## Command run

```bash
npm run export:twin   # == npx tsx scripts/export-twin-context.ts --dry-run
```

Executed against live Notion (the real `.env` in this repo — `NOTION_TOKEN`,
`DS_POSITIONS`, `DS_WIKI` are already configured from earlier phases). Fully
read-only: only `POST /v1/data_sources/{id}/query`, `GET
/v1/blocks/{id}/children`, `GET /v1/pages/{id}`, and `POST /v1/search` calls
were made. No Notion page/property was ever written.

## Validation summary (this run)

```
11 files total, 4 stub(s), 7 real export(s), 0 failure(s).
Validation passed (stubs are allowed — they are honest).
```

Per-file:

| File | Status | Size | Frontmatter |
|---|---|---|---|
| `soul.md` | ok | 47,219 B | valid |
| `packs/voice.md` | ok | 46,914 B | valid |
| `constitution.md` | ok | 39,126 B | valid |
| `packs/constitution-full.md` | ok | 56,810 B | valid |
| `context.md` | **stub** | 516 B | valid |
| `packs/positions.md` | ok | 36,705 B | valid |
| `packs/workflows/x.md` | **stub** | 544 B | valid |
| `packs/workflows/linkedin.md` | **stub** | 517 B | valid |
| `packs/workflows/ig-story.md` | ok | 10,044 B | valid |
| `packs/workflows/ig-carousel.md` | ok | 9,800 B | valid |
| `packs/workflows/substack.md` | **stub** | 556 B | valid |

`packs/positions.md`: built fully per the brief — queried `DS_POSITIONS` live
(43 rows), grouped by `Status` (all 43 currently `Active`; `Needs
validation`/`Retired` groups render only when non-empty), rendered
`Position` (title) + `Confidence` + `Last validated` + `Basis`/`Nuance`/
`Question`/`Articles` (rich_text, read defensively — a missing property
degrades to an omitted line, not a crash).

Exit code: `0`.

## Limitations

- **`soul.md`/`constitution.md` are raw mirrors, not curated distillations.**
  The canonical twin repo's short, hand-authored `soul.md` and
  `constitution.md` ("Identity in one paragraph", "Hard rules", "The
  Articles") are editorial condensations of the underlying Notion pages. This
  exporter is deterministic and mechanical — it cannot honestly produce that
  condensation without inventing text not literally present in Notion, which
  the brief prohibits. So in this exporter's output, `soul.md` and
  `constitution.md` are the full raw block-rendered text of the discovered
  source page (same substance as `packs/voice.md` / `packs/constitution-full.md`),
  with an explicit inline note saying so. **This is flagged prominently in
  the runbook as the single most important thing to check before ever
  applying a real `--target` run** — these two files must not silently
  overwrite the curated versions.
- **Four stub files** (`context.md`, `packs/workflows/{x,linkedin,substack}.md`)
  — no matching Notion page exists in this workspace as of this run, per the
  discovery report above. Not a script defect; a content gap upstream in
  Notion. Local reference markdown exists for some of these workflows at
  `/Users/isaacho/Documents/Claude/Projects/AI Constitution/` but is
  deliberately **not** used as a source — the brief specifies Notion as the
  sole source of truth for this exporter.
- **Source-quality artifact, not a script bug:** the "Brand Voice Guidelines"
  Notion page stores most of its content as a single oversized `heading_1`
  block (~9,500 characters) containing literal `n`/`nn` characters where line
  breaks were clearly intended (a pre-existing paste/import artifact in the
  Notion content itself). The exporter deliberately does not "fix" this
  (that would mean guessing where line breaks belong, i.e. inventing
  structure) — it mirrors the block verbatim and prepends a `<!--
  source-quality warning: ... -->` HTML comment whenever any rendered block
  exceeds 1,500 characters. This appeared in `soul.md` and `packs/voice.md`
  only; `constitution.md`/`packs/constitution-full.md` and both IG workflow
  exports were clean (properly separated blocks).
- **Block-type coverage** is limited to paragraph / heading 1-3 / bulleted &
  numbered lists / quote / divider / code, per the brief. Anything else
  (tables, images, callouts, toggles, to-dos, embeds) degrades to an inline
  `<!-- unsupported block type: X -->` comment. None of the discovered source
  pages in this run happened to use those types in a way that dropped
  meaningful content, but this should be watched on future runs if source
  pages are restructured.
- List/block recursion is capped at depth 4 to bound Notion API call volume;
  not observed to truncate anything in this run's content.
- No secrets were written to any output file — verified by grepping the full
  `hermes/export-preview/` tree for `NOTION_TOKEN`/`secret_` (see runbook);
  none found.

## Rollback

- Delete `hermes/export-preview/` (or `git checkout` it, since it's tracked)
  to remove all trace of this dry run.
- `scripts/export-twin-context.ts`, `hermes/runbooks/notion-exporter.md`, and
  this changelog are all net-new files — `git revert` the commit that adds
  them removes the exporter entirely.
- The `export:twin` line in `package.json` is a single additive script entry;
  removing it disables `npm run export:twin` without touching any other
  script.
- No Notion-side state exists to roll back — this script never wrote to
  Notion.
- `--target` mode was **not exercised** this phase (dry-run only, per the
  task focus); its backup mechanism (`<target>/.export-backups/<timestamp>/`)
  is implemented and documented in the runbook but unverified against a real
  twin-repo checkout. Recommend a supervised first `--target` run (with a
  throwaway copy of the twin repo, not the real one) before ever pointing it
  at `~/twin`.
