# Current architecture

Confirmed with Isaac on 7 October 2026.

Claude routines → Notion Personal Constitution → Command Center → Isaac's decisions → Notion.

- Claude routines perform drafting. Seven existing Claude Desktop/Cowork scheduled-task prompts were updated to reference the shared Notion training protocol on 7 October 2026. Execution of the updated prompts is pending the next scheduled runs.
- Notion is the source of truth for identity, platform workflows, drafts, survey answers, feedback and proposals.
- The app queries Notion directly. It does not load hermes-context, run a language model, or start a Hermes process.
- The app records edits, approvals and rejections in Notion. Survey answers are written into the Weekly Positions Survey. Confirm/reject also update linked position metadata; nuance is left for review.
- Accepting an identity proposal records approval. A separate preview-and-apply action appends the approved amendment to the verified Notion source and records the application revision. No model-weight update is implied.
- Publishing and reconciliation are Vercel cron jobs. Publishing depends on configured Typefully credentials and platform settings; explicit approval is required.
- The optional /api/agent API remains available for authorised automation using AGENT_API_TOKEN. It is not a running agent.

## Retired integration

Hermes routes, local worker scripts, exporter and their verification commands were removed. Historical design documents are marked retired. Historical Notion provenance values remain readable so old records are not relabelled. The separate hermes-context repository and existing Notion content were not modified.

## Training loop

Implemented: full feedback examples, one-off versus lasting preferences, previewed Notion amendments, routine-reported context usage, platform metrics, and human-scored held-out comparisons. See [training loop](training-loop.md).
