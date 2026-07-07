# Phase 10 — Publisher gating (verification + docs)

Done by the orchestrator directly (no sub-agent): the publishing layer already
met the brief. Changes: `publisher.failures24h` added to `GET /api/hermes/export`
(additive, version stays 1; counts `Publish-failed` Pipeline Events in the last
24h — same source as the dashboard banner), and a "Publisher gating" section in
`docs/hermes-integration.md` mapping each Phase 10 requirement to its existing
enforcement point. No behaviour changes to the publisher itself. Rollback:
revert the commit.
