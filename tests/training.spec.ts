import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const auth = async (page: import("@playwright/test").Page) => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const signature = createHmac("sha256", "local-ui-fixture-only").update(payload).digest("base64url");
  await page.context().addCookies([{ name: "twin_session", value: `${payload}.${signature}`, domain: "127.0.0.1", path: "/" }]);
};

test("training report presents empty state, feedback examples, and saves scope and reason", async ({ page }) => {
  await auth(page);
  const requests: { url: string; body: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/training") {
      return route.fulfill({ status: 200, json: {
        examples: [{ id: "12345678-1234-1234-1234-123456789abc", topic: "Clearer opening", platform: "x", previousText: "An older opener.", newText: "A more direct opening.", reason: "", scope: "unspecified", usedInDrafts: 2 }],
        runs: [{ id: "run-1", routine: "weekly-drafter", platform: "x", createdAt: "2026-10-06T03:00:00Z", draftId: "draft-1", feedbackIds: ["feedback-1"] }],
        metrics: { reviewed: 4, untouchedApprovalRate: 0.5, editedApprovalRate: 0.25, rejectionRate: 0.25, averageEditPercent: 18 },
        warnings: ["Metrics cover reported feedback only."],
      } });
    }
    if (url.pathname.startsWith("/api/training/examples/") && route.request().method() === "POST") {
      requests.push({ url: url.pathname, body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    if (url.pathname === "/api/queue") return route.fulfill({ json: { drafts: [], approved: [], manual: [], queued: [], posted: [], rejected: [] } });
    if (url.pathname === "/api/panels") return route.fulfill({ json: { positions: { total: 0, activeCount: 0, confidenceCounts: {}, needsValidation: [] }, inbox: [], wiki: [], publishFailures: [] } });
    if (url.pathname === "/api/proposals") return route.fulfill({ json: { proposals: [] } });
    if (url.pathname === "/api/training/evaluations") return route.fulfill({ json: { cases: [], evaluations: [], warnings: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#train");
  await expect(page.getByRole("heading", { name: "Training progress" })).toBeVisible();
  await expect(page.getByText("Reported review metrics")).toBeVisible();
  await expect(page.getByText("No routine usage reported yet.")).toHaveCount(0);
  await expect(page.getByText("A more direct opening.")).toBeHidden();
  await page.getByText("View before and after").click();
  await expect(page.getByText("An older opener.")).toBeVisible();
  await expect(page.getByText("A more direct opening.")).toBeVisible();
  await expect(page.getByText("weekly-drafter", { exact: false })).toBeVisible();

  await page.getByLabel("Reason").fill("Lead with the concrete claim.");
  await page.getByLabel("How broadly should this apply?").selectOption("once");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Feedback preference saved." })).toBeVisible();
  expect(requests).toEqual([{ url: "/api/training/examples/12345678-1234-1234-1234-123456789abc", body: { scope: "once", reason: "Lead with the concrete claim." } }]);
});

test("training report says no routine usage when its report is empty", async ({ page }) => {
  await auth(page);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/training") return route.fulfill({ json: { examples: [], runs: [], metrics: { reviewed: 0, untouchedApprovalRate: null, editedApprovalRate: null, rejectionRate: null, averageEditPercent: null }, warnings: [] } });
    if (path === "/api/queue") return route.fulfill({ json: { drafts: [], approved: [], manual: [], queued: [], posted: [], rejected: [] } });
    if (path === "/api/panels") return route.fulfill({ json: { positions: { total: 0, activeCount: 0, confidenceCounts: {}, needsValidation: [] }, inbox: [], wiki: [], publishFailures: [] } });
    if (path === "/api/proposals") return route.fulfill({ json: { proposals: [] } });
    if (path === "/api/training/evaluations") return route.fulfill({ json: { cases: [], evaluations: [], warnings: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/#train");
  await expect(page.getByText("No routine usage reported yet.")).toBeVisible();
  await expect(page.getByText("underlying model was retrained", { exact: false })).toBeVisible();
});

test("application preview keeps a conflicting update unapplied", async ({ page }) => {
  await auth(page);
  let submitted: unknown;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/proposals" && url.searchParams.get("status") === "accepted")
      return route.fulfill({ json: { proposals: [{ id: "proposal-1", topic: "A clear position", status: "accepted", targetType: "voice", proposedPositionText: "Use direct language." }] } });
    if (url.pathname === "/api/proposals/proposal-1/apply" && route.request().method() === "GET")
      return route.fulfill({ json: { targetTitle: "Voice guidelines", targetUrl: "https://www.notion.so/voice", text: "Use direct language.", digest: "preview-digest" } });
    if (url.pathname === "/api/proposals/proposal-1/apply" && route.request().method() === "POST") {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 409, json: { error: "The source or suggestion changed. Refresh the preview before applying." } });
    }
    if (url.pathname === "/api/queue") return route.fulfill({ json: { drafts: [], approved: [], manual: [], queued: [], posted: [], rejected: [] } });
    if (url.pathname === "/api/panels") return route.fulfill({ json: { positions: { total: 0, activeCount: 0, confidenceCounts: {}, needsValidation: [] }, inbox: [], wiki: [], publishFailures: [] } });
    if (url.pathname === "/api/training") return route.fulfill({ json: { examples: [], runs: [], metrics: { reviewed: 0, untouchedApprovalRate: null, editedApprovalRate: null, rejectionRate: null, averageEditPercent: null }, warnings: [] } });
    if (url.pathname === "/api/training/evaluations") return route.fulfill({ json: { cases: [], evaluations: [], warnings: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/#train");
  await page.getByRole("button", { name: "Preview Notion update" }).click();
  await expect(page.getByText("Use direct language.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply this amendment" }).click();
  await expect(page.getByRole("status").filter({ hasText: "source or suggestion changed" })).toBeVisible();
  expect(submitted).toEqual({ digest: "preview-digest" });
});
