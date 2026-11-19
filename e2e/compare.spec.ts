import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys, JOURNEY_STEPS } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const n = (v: number) => v.toLocaleString("en-US");
const reached = (list: typeof rows) => JOURNEY_STEPS.map((_, i) => list.filter((r) => r.steps[i] !== null).length);

async function load(page: import("@playwright/test").Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
}

test("compare two groups shows the generator's counts, flags the planted gap, and reacts to its controls", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Compare two groups" });
  const table = section.getByRole("table", { name: "Compare two groups" });

  // Segment new against returning is the default. The numbers match a count in plain code.
  const rn = reached(rows.filter((r) => r.segment === "new"));
  const rr = reached(rows.filter((r) => r.segment === "returning"));
  const last = table.getByRole("row", { name: /^Cart to Purchase/ });
  await expect(last).toContainText(`${n(rn[3])} of ${n(rn[2])}`);
  await expect(last).toContainText(`${n(rr[3])} of ${n(rr[2])}`);
  // The planted gap: new customers who reach the cart buy far less often, and the interval excludes zero.
  await expect(last).toContainText("interval excludes zero");
  // The flag comes from the Holm correction across the three steps. The planted gap survives it, and a step with no
  // planted gap is not flagged.
  await expect(last).toContainText(", flagged after Holm");
  await expect(table.getByRole("row", { name: /^Visit to Product/ })).toContainText("not flagged after Holm");
  await expect(section.locator("p", { hasText: "Comparisons made: 3." }).first()).toBeVisible();
  await expect(section.getByText(/exploratory and an association, not a finding that one group causes the gap/).first()).toBeVisible();

  // Channel comparison switches the groups and the numbers.
  await section.getByRole("button", { name: "Channel" }).click();
  const ra = reached(rows.filter((r) => r.channel === "ads"));
  const re = reached(rows.filter((r) => r.channel === "email"));
  const first = table.getByRole("row", { name: /^Visit to Product/ });
  await expect(first).toContainText(`${n(ra[1])} of ${n(ra[0])}`);
  await expect(first).toContainText(`${n(re[1])} of ${n(re[0])}`);

  // The same group twice is refused with a plain message and no table.
  await section.getByLabel("Second group").selectOption("ads");
  await expect(section.getByRole("alert").filter({ hasText: "Choose two different groups to compare." })).toBeVisible();
  await expect(table).toHaveCount(0);
});

test("the other charts' filters apply to the comparison too", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Compare two groups" });
  await page.getByRole("group", { name: "Filter by channel" }).getByRole("button", { name: /^ads, / }).click();
  const ads = rows.filter((r) => r.channel === "ads");
  const rn = reached(ads.filter((r) => r.segment === "new"));
  const rr = reached(ads.filter((r) => r.segment === "returning"));
  const row = section.getByRole("table", { name: "Compare two groups" }).getByRole("row", { name: /^Product to Cart/ });
  await expect(row).toContainText(`${n(rn[2])} of ${n(rn[1])}`);
  await expect(row).toContainText(`${n(rr[2])} of ${n(rr[1])}`);
});

test("compare two groups has a text version of its chart, no axe violations, and fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  const section = page.getByRole("region", { name: "Compare two groups" });
  await expect(section.getByRole("figure", { name: /Share of people who went on at each step, new and returning/ })).toBeVisible();
  await section.getByText("How this comparison was worked out").click();
  await expect(section.getByText("Wilson", { exact: false }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
