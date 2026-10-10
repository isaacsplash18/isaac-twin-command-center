import { test, expect, Page } from "@playwright/test";
import { createHmac } from "node:crypto";

const sample = (id: string, autoPublish = true) => ({
  id,
  platform: autoPublish ? "x" : "linkedin",
  platformLabel: autoPublish ? "X" : "LinkedIn",
  autoPublish,
  title:
    id === "one" ? "The work behind the work" : "A quieter kind of progress",
  body:
    id === "one"
      ? "The best systems make room for the human.\n\nA little structure gives good ideas somewhere to land. That’s the work behind the work."
      : "Some progress is quiet. You notice it in the decisions that get easier, and the things you no longer need to explain.",
  slides: null,
  status: "Draft",
  notionUrl: "https://www.notion.so/example",
  createdTime: "2026-10-06T01:00:00Z",
  lastEditedTime: "2026-10-06T01:00:00Z",
  scheduledAt: null,
  approvedAt: null,
  editedBeforeApproval: false,
  originalDraft: null,
  typefullyId: null,
  inCanva: false,
});
async function setup(
  page: Page,
  opts: {
    queueError?: boolean;
    approvalError?: boolean;
    partial?: boolean;
    longBody?: boolean;
  } = {},
) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const sig = createHmac("sha256", "local-ui-fixture-only")
    .update(payload)
    .digest("base64url");
  await page.context().addCookies([
    {
      name: "twin_session",
      value: `${payload}.${sig}`,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  let drafts = opts.partial ? [] : [sample("one"), sample("two", false)];
  if (opts.longBody) drafts[0].body = drafts[0].body.repeat(8);
  const mutations: { path: string; body: any }[] = [];
  const queue = () => ({
    drafts,
    manual: [],
    approved: [],
    queued: [
      {
        ...sample("scheduled"),
        status: "Queued",
        scheduledAt: "2026-10-07T00:30:00Z",
      },
    ],
    posted: [],
    rejected: [],
    fetchedAt: "2026-10-06T03:20:00Z",
    ...(opts.partial ? { warning: "A source is unavailable" } : {}),
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: any = {};
    let status = 200;
    if (url.pathname === "/api/queue") {
      body = opts.queueError
        ? { error: "Fixture connection failure" }
        : queue();
      status = opts.queueError ? 500 : 200;
    } else if (url.pathname === "/api/panels")
      body = {
        positions: {
          total: 2,
          activeCount: 2,
          confidenceCounts: { Confirmed: 2 },
          needsValidation: [],
        },
        inbox: [],
        wiki: [],
        publishFailures: [],
      };
    else if (url.pathname === "/api/calibration")
      body = { questions: [], pageUrl: "", roundIntro: "" };
    else if (url.pathname === "/api/proposals") body = { proposals: [] };
    else if (url.pathname === "/api/training") body = { examples: [], runs: [], metrics: { reviewed: 0, untouchedApprovalRate: null, editedApprovalRate: null, rejectionRate: null, averageEditPercent: null }, warnings: [] };
    else if (url.pathname === "/api/training/evaluations") body = { cases: [], evaluations: [], warnings: [] };
    else if (url.pathname === "/api/kpis")
      body = {
        overall: {
          untouchedApprovalRate: 0.72,
          editRate: 0.2,
          rejectionRate: 0.08,
          decisions: 25,
          draftsPerWeek: 12,
          medianTimeToApprovalHours: 1.5,
          publishFailures: 0,
        },
        dailyApprovals: [1, 3, 2, 4, 1, 3, 4],
        perPlatform: {},
      };
    else if (url.pathname.startsWith("/api/items/")) {
      mutations.push({
        path: url.pathname,
        body: route.request().postDataJSON(),
      });
      const id = url.pathname.split("/")[3];
      if (url.pathname.endsWith("/edit"))
        drafts = drafts.map((d) =>
          d.id === id
            ? {
                ...d,
                body: route.request().postDataJSON().text,
                editedBeforeApproval: true,
              }
            : d,
        );
      else if (opts.approvalError && url.pathname.endsWith("/approve")) {
        status = 500;
        body = { error: "Could not approve. Try again." };
      } else drafts = drafts.filter((d) => d.id !== id);
    }
    await route.fulfill({ status, json: body });
  });
  await page.goto("/");
  return mutations;
}

test("desktop review leads, navigation works, and search finds body text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  await expect(
    page.getByRole("heading", { name: "Needs your review" }),
  ).toBeVisible();
  await expect(page.locator("video")).toBeVisible();
  const bounds = await page.getByRole("article").first().boundingBox();
  expect(bounds!.y).toBeLessThan(600);
  await page.getByRole("button", { name: /Search & commands/ }).click();
  await page
    .getByRole("textbox", { name: "Search drafts and commands" })
    .fill("structure");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: /The work behind the work/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  for (const name of ["Schedule", "Train your twin", "More", "Review"])
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name, exact: name !== "Review" })
      .click();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThan(1);
  await page.screenshot({
    path: "test-results/review-desktop.png",
    fullPage: true,
  });
});

test("mobile navigation fits and no hidden gesture is needed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/review-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Schedule", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your publishing plan." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Search & commands/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close search" }).click();
});

test("approval communicates the actual publishing mode", async ({ page }) => {
  const mutations = await setup(page);
  await page
    .locator("#draft-one")
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(
    page.getByText("Approved. Waiting for the scheduler", { exact: false }),
  ).toBeVisible();
  await expect(page.locator("#draft-one")).toHaveCount(0);
  await page
    .locator("#draft-two")
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await expect(
    page.getByText("Approved. Ready to copy and post from Schedule."),
  ).toBeVisible();
  expect(mutations.map((m) => m.path)).toEqual([
    "/api/items/one/approve",
    "/api/items/two/approve",
  ]);
});

test("reject can cancel, then clearly reject without feedback", async ({
  page,
}) => {
  const mutations = await setup(page);
  const draft = page.locator("#draft-one");
  await draft.getByRole("button", { name: "Reject", exact: true }).click();
  await draft.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(mutations).toHaveLength(0);
  await draft.getByRole("button", { name: "Reject", exact: true }).click();
  await draft
    .getByRole("button", { name: "Reject without feedback", exact: true })
    .click();
  await expect(draft).toHaveCount(0);
  expect(mutations[0].path).toBe("/api/items/one/reject");
});

test("save and approve persists text before approving", async ({ page }) => {
  const mutations = await setup(page);
  const draft = page.locator("#draft-one");
  await draft.getByRole("button", { name: "Edit", exact: true }).click();
  await draft
    .getByRole("textbox", { name: "Edit draft" })
    .fill("A carefully edited thought.");
  await draft
    .getByRole("button", { name: "Save & approve", exact: true })
    .click();
  await expect(draft).toHaveCount(0);
  expect(mutations.map((m) => m.path)).toEqual([
    "/api/items/one/edit",
    "/api/items/one/approve",
  ]);
  expect(mutations[0].body.text).toBe("A carefully edited thought.");
});

test("failed approval preserves the draft and reports the error", async ({
  page,
}) => {
  await setup(page, { approvalError: true });
  const draft = page.locator("#draft-one");
  await draft.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(draft).toBeVisible();
  await expect(draft.getByRole("alert")).toContainText("Could not approve");
  await expect(
    page.getByText("Approved. Waiting for the scheduler", { exact: false }),
  ).toHaveCount(0);
});

test("failed and partial loads never claim the queue is clear", async ({
  page,
}) => {
  await setup(page, { queueError: true });
  await expect(page.getByText("We couldn’t load your drafts")).toBeVisible();
  await expect(page.getByText("You’re all caught up")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Retry connection" }),
  ).toBeVisible();
});

test("partial empty results show a warning", async ({ page }) => {
  await setup(page, { partial: true });
  await expect(
    page.getByText("Drafts are temporarily unavailable"),
  ).toBeVisible();
  await expect(page.getByText("You’re all caught up")).toHaveCount(0);
});

test("global draft search clears a conflicting local filter", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("searchbox", { name: "Search drafts", exact: true })
    .fill("nothing matches");
  await expect(
    page.getByText("No matching drafts", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Search & commands", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search drafts and commands" })
    .fill("structure");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /The work behind the work/ })
    .click();
  await expect(page.locator("#draft-one")).toBeVisible();
});

test("mobile floating controls belong only to the draft being read", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { longBody: true });
  await page
    .locator("#draft-one")
    .evaluate((el) =>
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 100),
    );
  await expect(page.locator(".review-actions.fixed")).toHaveCount(1);
  const actions = await page.locator(".review-actions.fixed").boundingBox();
  const nav = await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .boundingBox();
  expect(actions!.y + actions!.height).toBeLessThanOrEqual(nav!.y);
  await page.screenshot({ path: "test-results/mobile-review-active.png" });
});

test("saving changes keeps the updated draft in review", async ({ page }) => {
  const mutations = await setup(page);
  const draft = page.locator("#draft-one");
  await draft.getByRole("button", { name: "Edit", exact: true }).click();
  await draft
    .getByRole("textbox", { name: "Edit draft" })
    .fill("A saved thought.");
  await draft
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    draft.getByText("A saved thought.", { exact: true }),
  ).toBeVisible();
  expect(mutations.map((m) => m.path)).toEqual(["/api/items/one/edit"]);
});

test("hologram is visible by default and can be paused", async ({ page }) => {
  await setup(page);
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Pause motion" }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  const pausedTimes = await video.evaluate(async (v: HTMLVideoElement) => {
    const before = v.currentTime;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return [before, v.currentTime];
  });
  expect(pausedTimes[1]).toBe(pausedTimes[0]);
  await expect(
    page.getByRole("button", { name: "Resume motion" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("hologram respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await expect(page.locator("video")).toBeVisible();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
});
