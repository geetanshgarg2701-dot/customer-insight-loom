import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { JOURNEY_STEPS, syntheticJourneys } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const moved = (list: typeof rows, i: number) => list.filter((r) => r.steps[i + 1] !== null).length;

async function load(page: import("@playwright/test").Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
}

test("time between steps shows the generator's counts, follows filters, and states its window", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Time between steps" });
  const table = section.getByRole("table", { name: "Time between steps" });
  for (let i = 0; i < JOURNEY_STEPS.length - 1; i++) {
    const row = table.getByRole("row", { name: new RegExp(`^${JOURNEY_STEPS[i]} to ${JOURNEY_STEPS[i + 1]} `) });
    await expect(row.getByRole("cell").nth(1)).toHaveText(moved(rows, i).toLocaleString("en-US"));
    // Every window in the demo has closed, so nobody is still waiting.
    await expect(row.getByRole("cell").nth(5)).toHaveText("0");
  }
  await expect(table.locator("caption")).toHaveText("7 day window from entry, data cutoff 2026-10-15");
  await expect(section.getByText(/^Of [\d,]+ people who went from Cart to Purchase, half took less than/)).toBeVisible();

  // The window control changes what is stated.
  await section.getByRole("group", { name: "Window from entry" }).getByRole("button", { name: "30 days" }).click();
  await expect(table.locator("caption")).toHaveText("30 day window from entry, data cutoff 2026-10-15");

  // The segment filter applies here too.
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / }).click();
  const fresh = rows.filter((r) => r.segment === "new");
  const last = table.getByRole("row", { name: /^Cart to Purchase / });
  await expect(last.getByRole("cell").nth(1)).toHaveText(moved(fresh, 2).toLocaleString("en-US"));
});

test("time between steps has a named chart, no axe violations, and fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  const section = page.getByRole("region", { name: "Time between steps" });
  await expect(section.getByRole("figure", { name: /Hours between steps/ })).toBeVisible();
  await section.getByText("How time between steps was worked out").click();
  await expect(section.getByText("linear interpolation", { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
