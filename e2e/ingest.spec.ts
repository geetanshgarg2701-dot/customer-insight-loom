import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the sandbox shows each receiver rule: duplicates, bad signatures, limits, late and future events, and the review list", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/ingest");
  const state = page.getByRole("region", { name: "What it holds" });
  const status = page.getByRole("region", { name: "Send something" }).getByRole("status");
  await expect(page.getByRole("button", { name: "Send a good event" })).toBeEnabled();

  // A good event is stored, and a resend is counted as a duplicate and not stored again.
  await page.getByRole("button", { name: "Send a good event" }).click();
  await expect(status).toContainText("status 200");
  await expect(state).toContainText("1 events accepted, 0 duplicates counted, 0 bad requests refused, 0 on the review list.");
  await page.getByRole("button", { name: "Send the last good event again" }).click();
  await expect(status).toContainText("status 200");
  await expect(state).toContainText("1 events accepted, 1 duplicates counted");

  // A changed body and an old timestamp are both 401, with the reason kept as a count and no body.
  await page.getByRole("button", { name: "Send with a changed body" }).click();
  await expect(status).toContainText("status 401");
  await expect(status).toContainText('{"error":"unauthorized"}');
  await page.getByRole("button", { name: "Send with an old timestamp" }).click();
  await expect(status).toContainText("status 401");
  const reasons = state.getByRole("table", { name: "Refused requests by reason" });
  await expect(reasons.getByRole("row", { name: /^bad signature 1$/ })).toBeVisible();
  await expect(reasons.getByRole("row", { name: /^timestamp outside the 5 minute window 1$/ })).toBeVisible();

  // Size and count limits.
  await page.getByRole("button", { name: "Send an oversize body" }).click();
  await expect(status).toContainText("status 413");
  await expect(reasons.getByRole("row", { name: /^payload over 256 KB 1$/ })).toBeVisible();
  await page.getByRole("button", { name: "Send 101 events in one request" }).click();
  await expect(status).toContainText("status 400");
  await expect(status).toContainText("at most 100 events");

  // Late, future and unmapped events go to the review list with their reasons.
  await page.getByRole("button", { name: "Send an event from 40 days ago" }).click();
  await page.getByRole("button", { name: "Send an event 2 days ahead" }).click();
  await page.getByRole("button", { name: "Send an unmapped step" }).click();
  const review = page.getByRole("table", { name: "Review list" });
  await expect(review.getByRole("row")).toHaveCount(4);
  await expect(review.getByRole("row", { name: /too late.*more than 30 days old/ })).toBeVisible();
  await expect(review.getByRole("row", { name: /in future.*more than 24 hours in the future/ })).toBeVisible();
  await expect(review.getByRole("row", { name: /rejected.*step is not one this sender maps/ })).toBeVisible();
  // Only a too late event can be accepted by hand.
  await expect(review.getByRole("button", { name: /^Accept by hand, review item \d+$/ })).toHaveCount(1);

  // Accept the late one by hand: it leaves the list and is stored. Dismiss another: it leaves and is not stored.
  await review.getByRole("button", { name: /^Accept by hand, review item \d+$/ }).click();
  await expect(state).toContainText("2 events accepted");
  await expect(review.getByRole("row")).toHaveCount(3);
  await review.getByRole("button", { name: /^Dismiss review item/ }).first().click();
  await expect(state).toContainText("2 events accepted");
  await expect(review.getByRole("row")).toHaveCount(2);

  // No email is ever shown.
  expect(await page.locator("body").innerText()).not.toMatch(/@example\.invalid/);
});

test("the 61st request in a minute gets 429 with Retry-After, and a full store defers good events", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/ingest");
  const status = page.getByRole("region", { name: "Send something" }).getByRole("status");
  await expect(page.getByRole("button", { name: "Send a good event" })).toBeEnabled();
  await page.getByRole("button", { name: "Send 61 requests in a row" }).click();
  await expect(status).toContainText("the last of 61 requests: status 429");
  await expect(status).toContainText(/Retry-After: [1-9]\d?\./);
});

test("a full store answers 503 and lists the event as deferred", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/ingest");
  await expect(page.getByRole("button", { name: "Send a good event" })).toBeEnabled();
  await page.getByLabel("Pretend storage is full, so good events are deferred").check();
  await page.getByRole("button", { name: "Send a good event" }).click();
  const status = page.getByRole("region", { name: "Send something" }).getByRole("status");
  await expect(status).toContainText("status 503");
  await expect(status).toContainText("Retry-After: 3600.");
  await expect(page.getByRole("table", { name: "Review list" }).getByRole("row", { name: /deferred.*storage is full/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "What it holds" })).toContainText("0 events accepted");
});

test("the sandbox has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/ingest");
  await expect(page.getByRole("button", { name: "Send a good event" })).toBeEnabled();
  await page.getByRole("button", { name: "Send an event from 40 days ago" }).click();
  await page.getByRole("button", { name: "Send with a changed body" }).click();
  await expect(page.getByRole("table", { name: "Review list" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
