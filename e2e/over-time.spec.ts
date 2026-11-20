import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { JOURNEY_STEPS, syntheticJourneys } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const n = (v: number) => v.toLocaleString("en-US");

/** People who had reached each step by the end of a UTC day, counted from the generator. */
function byEndOf(day: string, keep: (r: (typeof rows)[number]) => boolean = () => true) {
  return JOURNEY_STEPS.map(
    (s) => rows.filter((r) => keep(r) && r.steps.includes(s) && r.times[r.path.indexOf(s)].slice(0, 10) <= day).length,
  );
}

async function load(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  return page.getByRole("region", { name: "Journey over time" });
}

test("the funnel by day matches the generator, follows the scrubber and the filters, and says when no test has launched", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/journeys");
  const section = await load(page);
  const status = section.getByRole("status");
  const slider = section.getByLabel("Day", { exact: true });

  const last = await slider.getAttribute("aria-valuetext");
  const end = byEndOf(last!);
  await expect(status).toContainText(`By the end of ${last}: ${n(end[0])} had entered, ${n(end[1])} reached Product, ${n(end[2])} reached Cart, ${n(end[3])} reached Purchase.`);
  expect(end[0]).toBe(100_000);

  await section.getByRole("button", { name: "Day before" }).click();
  const earlier = await slider.getAttribute("aria-valuetext");
  expect(earlier! < last!).toBe(true);
  const e2 = byEndOf(earlier!);
  await expect(status).toContainText(`By the end of ${earlier}: ${n(e2[0])} had entered,`);

  // A mid period day, set with the slider.
  await slider.fill("10");
  const mid = await slider.getAttribute("aria-valuetext");
  const m = byEndOf(mid!);
  await expect(status).toContainText(`By the end of ${mid}: ${n(m[0])} had entered, ${n(m[1])} reached Product`);

  // A filter applies, and the day stays.
  await page.getByRole("group", { name: "Filter by channel" }).getByRole("button", { name: /^email, / }).click();
  const f = byEndOf(mid!, (r) => r.channel === "email");
  await expect(status).toContainText(`By the end of ${mid}: ${n(f[0])} had entered,`);

  await expect(section.getByText("No ledger test has launched yet.")).toBeVisible();
  await section.getByText("Show as table").click();
  await expect(section.getByRole("table", { name: "People who had reached each step, by day" }).getByRole("row", { name: new RegExp(`^${mid}`) })).toBeVisible();
});

test("the July demo test is marked on its day with a before and after count, and the others are listed outside", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Journeys" }).click();
  const section = await load(page);
  await expect(section.getByText(/^3 ledger tests launched outside these dates/)).toBeVisible();
  const marked = section.getByRole("list", { name: "Ledger tests launched during these days" }).getByRole("listitem");
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText("Synthetic: free shipping banner at the cart, launched in July, launched 2026-07-15.");

  // Purchases a day over the 7 days before and the 7 days from launch, counted from the generator.
  const purchasesOn = (day: string) => rows.filter((r) => r.steps[3] !== null && r.times[r.path.indexOf("Purchase")].slice(0, 10) === day).length;
  const dayAt = (offset: number) => new Date(Date.parse("2026-07-15T00:00:00Z") + offset * 86_400_000).toISOString().slice(0, 10);
  const before = [-7, -6, -5, -4, -3, -2, -1].reduce((t, d) => t + purchasesOn(dayAt(d)), 0) / 7;
  const after = [0, 1, 2, 3, 4, 5, 6].reduce((t, d) => t + purchasesOn(dayAt(d)), 0) / 7;
  await expect(marked).toContainText(`Purchases a day: ${before.toFixed(1)} over the 7 days before, and ${after.toFixed(1)} over the 7 days from launch.`);
  await expect(marked).toContainText("not the test’s measured lift");
});

test("the journey over time section has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/journeys");
  const section = await load(page);
  await section.getByText("Show as table").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='h-over-time']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
