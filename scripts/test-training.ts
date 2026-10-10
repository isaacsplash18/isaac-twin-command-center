import assert from "node:assert/strict";
import { editPercent, trainingMetrics } from "../lib/training-metrics";

const event = (
  objectId: string,
  action: string,
  createdAt: string,
  previousText = "",
  newText = "",
) => ({ objectId, action, createdAt, previousText, newText, platform: "x" });

const metrics = trainingMetrics([
  // The newest event for a draft wins; the older rejection must not add another decision.
  event("draft-a", "reject", "2026-01-01T00:00:00Z", "old", ""),
  event("draft-a", "approve", "2026-01-02T00:00:00Z", "old text", "new text"),
  // A second approval with the same object id is deduplicated as well.
  event("draft-a", "approve", "2026-01-01T12:00:00Z", "old text", "other text"),
  event("draft-b", "approve", "2026-01-03T00:00:00Z", "", "untouched"),
  event("draft-c", "reject", "2026-01-04T00:00:00Z", "draft", ""),
  event("draft-d", "edit", "2026-01-05T00:00:00Z", "draft", "edited"),
]);

assert.equal(metrics.reviewed, 3, "count one latest decision per draft");
assert.equal(metrics.untouchedApprovalRate, 1 / 3);
assert.equal(metrics.editedApprovalRate, 1 / 3);
assert.equal(metrics.rejectionRate, 1 / 3);
assert.equal(metrics.averageEditPercent, 50);

const empty = trainingMetrics([]);
assert.deepEqual(empty, {
  reviewed: 0,
  untouchedApprovalRate: null,
  editedApprovalRate: null,
  rejectionRate: null,
  averageEditPercent: null,
});
assert.equal(editPercent("same text", "same text"), 0);
assert.equal(editPercent("", "one"), 100);

console.log("Training metric assertions passed.");
