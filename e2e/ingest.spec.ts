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
  await expect(state).toContainText("1 events accepted, 0 duplicates counted, 0 bad requests refused, 0 on the review list, 0 ignored by the step map.");
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
  await expect(review.getByRole("row", { name: /unmapped.*the step name "checkout_started" is not mapped yet.*checkout_started/ })).toBeVisible();
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

test("an unmapped step name waits, is mapped by a person, and the waiting events are then stored; ignored and unsafe names are handled", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/ingest");
  await expect(page.getByRole("button", { name: "Send a good event" })).toBeEnabled();
  const steps = page.getByRole("region", { name: "Step names" });
  const state = page.getByRole("region", { name: "What it holds" });
  const review = page.getByRole("table", { name: "Review list" });

  // The starting map is shown, with the ignored name.
  await expect(steps.getByRole("table", { name: "Mapped step names" }).getByRole("row", { name: "add_to_cart Cart" })).toBeVisible();
  await expect(steps.getByRole("table", { name: "Mapped step names" }).getByRole("row", { name: "newsletter_open Ignored" })).toBeVisible();
  await expect(steps.getByText("No unmapped names have arrived.")).toBeVisible();

  // An ignored name is counted and not stored. An unsafe name is rejected and never listed for mapping.
  await page.getByRole("button", { name: "Send an ignored step" }).click();
  await expect(state).toContainText("0 events accepted, 0 duplicates counted, 0 bad requests refused, 0 on the review list, 1 ignored by the step map.");
  await page.getByRole("button", { name: "Send a step name in an unsafe form" }).click();
  await expect(review.getByRole("row", { name: /rejected.*step is not a usable name/ })).toBeVisible();
  await expect(steps.getByText("No unmapped names have arrived.")).toBeVisible();
  expect(await page.locator("b").count()).toBe(0);

  // Two unmapped events wait, under one name, with no suggestion because the name gives no clear clue.
  await page.getByRole("button", { name: "Send an unmapped step" }).click();
  await page.getByRole("button", { name: "Send an unmapped step" }).click();
  const choice = steps.getByLabel(/^checkout_started, 2 events waiting, no suggestion/);
  await expect(choice).toHaveValue("");
  await expect(review.getByRole("row", { name: /^unmapped/ })).toHaveCount(2);

  // A person maps it to Cart and applies it. Both events are stored as Cart, and the name joins the map.
  await choice.selectOption("Cart");
  await steps.getByRole("button", { name: "Apply this mapping to the waiting events" }).click();
  await expect(steps.getByRole("status")).toHaveText("Mapping applied: 2 stored, 0 ignored, 0 moved to the review list by the age rules, 0 still waiting.");
  await expect(state).toContainText("2 events accepted");
  await expect(review.getByRole("row", { name: /^unmapped/ })).toHaveCount(0);
  await expect(steps.getByRole("table", { name: "Mapped step names" }).getByRole("row", { name: "checkout_started Cart" })).toBeVisible();
  await expect(steps.getByText("No unmapped names have arrived.")).toBeVisible();

  // No email is ever shown. A resend counting as a duplicate is checked in the unit tests.
  expect(await page.locator("body").innerText()).not.toMatch(/@example\.invalid/);
});
