# Current architecture

Confirmed with Isaac on 7 October 2026.

Claude routines → Notion Personal Constitution → Command Center → Isaac's decisions → Notion.

- Claude routines perform drafting. Their live configuration and execution logs have not been audited from this repository.
- Notion is the source of truth for identity, platform workflows, drafts, survey answers, feedback and proposals.
- The app queries Notion directly. It does not load hermes-context, run a language model, or start a Hermes process.
- The app records edits, approvals and rejections in Notion. Survey answers are written into the Weekly Positions Survey. Confirm/reject also update linked position metadata; nuance is left for review.
- Accepting an identity proposal only records acceptance. It does not apply its text to canonical Notion pages. No automatic learning or model-weight update is implied.
- Publishing and reconciliation are Vercel cron jobs. Publishing depends on configured Typefully credentials and platform settings; explicit approval is required.
- The optional /api/agent API remains available for authorised automation using AGENT_API_TOKEN. It is not a running agent.

## Retired integration

Hermes routes, local worker scripts, exporter and their verification commands were removed. Historical design documents are marked retired. Historical Notion provenance values remain readable so old records are not relabelled. The separate hermes-context repository and existing Notion content were not modified.

## Proposed feedback improvements (not implemented)

1. Make each drafting routine read current voice rules, relevant positions and a small selection of Isaac-approved examples and corrections from Notion.
2. Preserve original draft, final edit, rejection reason and platform together as reusable examples. Let Isaac mark an edit as one-off or a lasting preference.
3. Have calibration propose explicit changes with evidence, then apply approved changes to the exact Notion source and record its URL, revision and applied timestamp. Acceptance and application must remain distinct.
4. Record each routine's source pages, source edit times and feedback cutoff, so the app can show whether feedback was consumed.
5. Compare changes on a fixed set of held-out topics before adoption. Track untouched approval rate, editing effort and repeated rule violations per platform.

This improves context and feedback use. It does not fine-tune model weights.
