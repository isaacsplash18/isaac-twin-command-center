# Training loop

Claude/Cowork routines → Personal Constitution in Notion → Command Center → corrections and approved amendments → the next routine.

## Feedback

New edit, approval and rejection events preserve snapshots up to 60,000 characters (Notion rich text is chunked). Older events may already have been truncated; no lost historical text is fabricated. In Train your twin, mark a correction as this post only, a lasting preference, or undecided. A lasting preference requires a reason and creates a pending suggestion. An edit alone no longer creates a voice rule.

## Apply

Accepting still records approval only. The separate application panel previews the exact approved text and destination. Applying appends a labelled amendment to an allowlisted voice/constitution/workflow page or a verified Positions Library row. It does not replace the full document. A digest includes the proposal text, proposal revision and destination revision; stale previews return 409. Marker detection supports retry after an append succeeded but status bookkeeping failed. Notion provides no cross-request transaction; concurrent requests are not guaranteed atomic. Read the marker on recovery rather than blindly reappending.

Applied URL, Applied At and Applied Revision are recorded on the proposal. Existing source rules and user approval remain authoritative; conflicting amendments should be surfaced for review by the routine.

## Routine context and receipts

The shared protocol is https://www.notion.so/3f11fec9ef8381d08693d07dd1d656ad under Personal Constitution. Cowork can use its existing Notion connector directly, without any new credential or model provider. A context receipt lists source page IDs/revisions, platform, feedback IDs and a retrieval cutoff. After saving an actual draft, the routine records only feedback it reports using. Reports are explicitly self-reported; a context read alone does not count as consumption.

Optional bearer-authenticated Agent API:

- POST /api/agent/training/context with `{platform, topic}` returns fresh voice, constitution, workflow, relevant positions, up to five lasting corrections, approved examples and a persisted contextId.
- POST /api/agent/training/runs with `{routine, draftId, contextId, feedbackIds}` validates database membership, platform and receipt membership before recording usage. Context retrieval never generates or publishes a draft.

`DS_TRAINING` points to Training Records. `npm run migrate:training` adds the fields and database without altering existing records; it reads `.env.training.local` for operator use. No secrets belong in source control.

## Evaluation

Five fixed topics are excluded from context-example retrieval. Isaac records baseline and candidate outputs, their version labels, a winner and violated rules. The app groups outcomes by version pair and counts recurring violations. There are no fabricated wins, automatic quality claims or model-weight updates. Use identical source snapshots and topics for fair comparisons; collect enough observations before drawing conclusions.

Review metrics deduplicate the latest approve/reject decision per draft in the latest 100 feedback events and show sample sizes. Rates use reviewed drafts as denominator. Editing effort is word edit distance over the first 3,000 words, averaged over edited approvals. Platform breakdowns are available. Routine history is bounded to 300 recent records. Empty history means unreported, not a healthy run.

## Existing Cowork tasks updated

On 7 October 2026, the saved instructions were updated for Daily x tweet draft, Daily substack note draft, Linkedin post draft cloud, Linkedin alternate day draft, Daily x reply radar, Weekly constitution calibration, and Substack ig weekly sync. Schedules, models and permissions were preserved. Updated executions and real usage receipts are pending subsequent runs. Both LinkedIn draft schedules currently exist and overlap; this change does not disable either.

## In-app comparison queue

Train shows pending pairs with hidden methods and stable A/B ordering. Choose A, B, both good, or neither, optionally explain, and save to advance. Unsubmitted answers persist in this browser. Completed judgments stay in Notion; methods are revealed in history. Earlier manually recorded evaluations remain visible.

The default scope is this comparison only. Remembering requires a separate explicit instruction. Only that instruction enters platform-matched drafting context (up to 20 active comparison preferences); neither draft is retrieved as an example. History lets the user revoke it. This updates context, not model weights, and training comparisons are not independent benchmarks.

Training Records now supports Kind `comparison`; run `npm run migrate:training` to add the select option safely. `POST /api/agent/training/comparisons` accepts caseId, title, baseline, candidate, baselineVersion, candidateVersion, sourceSnapshot, sourceUrl and limitations. It assigns A/B ordering and a duplicate key on the server. Agents cannot submit human judgments through this endpoint. The existing weekly Claude routine's shared Notion protocol describes queue replenishment.

`GET /api/training/evaluations` returns pending and completed comparisons plus legacy evaluations. Session-authenticated `POST /api/training/comparisons/:id` saves choice, reason, scope, explicit preference and digest; stale content is rejected. Identical retries do not create duplicate records. `DELETE` revokes the preference while keeping the judgment. Notion does not provide conditional writes, so simultaneous conflicting submissions across multiple devices are not transactionally serialized.

The agent context endpoint includes `preferences` and `preferenceIds`; report consumed comparison IDs separately from CalibrationEvents `feedbackIds` in run reports. Reports reject IDs absent from the receipt or no longer active. Routines using the Notion connector directly must follow the same shared protocol.
