import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { JOURNEYS_AS_OF, syntheticJourneys, type JourneyRow } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const DAY = 86_400_000;
const cutoff = Date.parse(JOURNEYS_AS_OF);
const n = (v: number) => v.toLocaleString("en-US");
const at = (r: JourneyRow, step: string) => Date.parse(r.times[r.path.indexOf(step)]);

async function load(page: import("@playwright/test").Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  return page.getByRole("region", { name: "Designed journey" });
}

function waitCounts(keep: (r: JourneyRow) => boolean, step: number, days: number) {
  const from = ["Visit", "Product", "Cart"][step];
  const to = ["Product", "Cart", "Purchase"][step];
  const people = rows.filter((r) => keep(r) && r.steps[step] !== null);
  const wait = days * DAY;
  return {
    within: people.filter((r) => r.steps[step + 1] !== null && at(r, to) - at(r, from) <= wait).length,
    later: people.filter((r) => r.steps[step + 1] !== null && at(r, to) - at(r, from) > wait).length,
    stillWaiting: people.filter((r) => r.steps[step + 1] === null && cutoff < at(r, from) + wait).length,
    outlasted: people.filter((r) => r.steps[step + 1] === null && cutoff >= at(r, from) + wait).length,
  };
}

function exitCounts(keep: (r: JourneyRow) => boolean, days: number) {
  const people = rows.filter(keep);
  const last = (r: JourneyRow) => Date.parse(r.times[r.times.length - 1]);
  const rest = people.filter((r) => r.steps[3] === null);
  return {
    goal: people.length - rest.length,
    inactive: rest.filter((r) => last(r) + days * DAY <= cutoff).length,
    active: rest.filter((r) => last(r) + days * DAY > cutoff).length,
  };
}

test("the wait and exit nodes show counts from the data, follow their choices and the filters, and are in the table", async ({ page }) => {
  test.setTimeout(240_000);
  const section = await load(page);
  const wait = section.locator('.react-flow__node[data-id="rule-wait"]');
  const exit = section.locator('.react-flow__node[data-id="rule-exit"]');

  // The defaults: a 3 day wait after the Cart, and exit when inactive for 14 days.
  const w = waitCounts(() => true, 2, 3);
  await expect(wait).toContainText("Wait 3 days after Cart");
  await expect(wait).toContainText(`${n(w.within)} went on to Purchase within it`);
  await expect(wait).toContainText(`${n(w.later)} went on later`);
  await expect(wait).toContainText(`${n(w.outlasted)} sat through it`);
  await expect(wait).toContainText(`${n(w.stillWaiting)} still waiting`);
  const x = exitCounts(() => true, 14);
  await expect(exit).toContainText(`${n(x.goal)} reached the goal`);
  await expect(exit).toContainText(`${n(x.inactive)} inactive for 14 days or more`);
  await expect(exit).toContainText(`${n(x.active)} still active`);
  expect(x.goal + x.inactive + x.active).toBe(100_000);

  // A different wait, a different step, and a longer inactivity rule.
  await section.getByLabel("Wait length").selectOption("7");
  const w7 = waitCounts(() => true, 2, 7);
  await expect(wait).toContainText(`${n(w7.within)} went on to Purchase within it`);
  await section.getByLabel("Wait after step").selectOption("1");
  const wp = waitCounts(() => true, 1, 7);
  await expect(wait).toContainText("Wait 7 days after Product");
  await expect(wait).toContainText(`${n(wp.within)} went on to Cart within it`);
  await section.getByLabel("Inactivity rule").selectOption("90");
  const x90 = exitCounts(() => true, 90);
  await expect(exit).toContainText(`${n(x90.inactive)} inactive for 90 days or more`);
  await expect(exit).toContainText(`${n(x90.active)} still active`);
  expect(x90.active).toBeGreaterThan(0);

  // A filter applies to both rules.
  await page.getByRole("group", { name: "Filter by channel" }).getByRole("button", { name: /^email, / }).click();
  const xe = exitCounts((r) => r.channel === "email", 90);
  await expect(exit).toContainText(`${n(xe.goal)} reached the goal`);

  // The table lists every group, so nothing depends on seeing the picture.
  await section.getByText("Show as table").click();
  const table = section.getByRole("table", { name: "Designed rules" });
  await expect(table.getByRole("row", { name: /^Exit conditions Reached the goal/ })).toContainText(n(xe.goal));
  await expect(table.getByRole("row")).toHaveCount(8);
});

test("a choice made while the page is still loading is kept, not overwritten by the first load", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  const section = page.getByRole("region", { name: "Designed journey" });
  // The choice is made as soon as it exists, before the lower sections have finished counting.
  await expect(section.getByLabel("Inactivity rule")).toBeVisible({ timeout: 180_000 });
  await section.getByLabel("Inactivity rule").selectOption("90");
  await section.getByLabel("Wait length").selectOption("7");
  // Give a stale first load every chance to land after the choice.
  await page.waitForTimeout(4_000);
  const exit = section.locator('.react-flow__node[data-id="rule-exit"]');
  await expect(exit).toContainText("inactive for 90 days or more");
  await expect(section.locator('.react-flow__node[data-id="rule-wait"]')).toContainText("Wait 7 days after Cart");
  await expect(section.getByLabel("Inactivity rule")).toHaveValue("90");
});

test("the designed rules have no axe violations and fit a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const section = await load(page);
  await section.getByText("Show as table").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='h-designed']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n2) => n2.target.join(" ")).join(" | ")}`)).toEqual([]);
});
