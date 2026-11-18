import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys } from "../src/lib/demo/journeys";

const ROWS = 100_000;
const rows = syntheticJourneys(ROWS, 11);
const next = (event: string, after: string | null) =>
  rows.filter((r) => {
    const i = r.path.indexOf(event);
    return i >= 0 && (r.path[i + 1] ?? null) === after;
  }).length;
const did = (event: string) => rows.filter((r) => r.path.includes(event)).length;

test("around one event shows what the generator says, and reacts to its controls", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });

  const section = page.getByRole("region", { name: "Around one event" });
  await expect(section.getByText(`${did("Cart").toLocaleString("en-US")} of 100,000 customers did Cart.`)).toBeVisible();

  const table = section.getByRole("table", { name: "Around one event" });
  const row = (step: string, event: string) => table.getByRole("row").filter({ has: page.getByRole("cell", { name: step, exact: true }) }).filter({ hasText: event });
  await expect(row("+1", "Purchase")).toContainText(next("Cart", "Purchase").toLocaleString("en-US"));
  await expect(row("+1", "Support")).toContainText(next("Cart", "Support").toLocaleString("en-US"));
  await expect(table.getByRole("row", { name: new RegExp(`^Ended after anchor, path ends ${next("Cart", null).toLocaleString("en-US")}$`) })).toBeVisible();

  // Choosing another event, here the Search detour, redraws the view from that event.
  await section.getByRole("combobox").selectOption({ label: `Search, ${did("Search").toLocaleString("en-US")} customers` });
  await expect(section.getByText(`${did("Search").toLocaleString("en-US")} of 100,000 customers did Search.`)).toBeVisible();

  // Naming only the top 3 groups the rest, and the grouped row says how many kinds, with all of them showing none.
  await section.getByRole("group", { name: "Events named per step" }).getByRole("button", { name: "All" }).click();
  await expect(table.getByText(/Other events, \d+ kinds/)).toHaveCount(0);

  // Filtering by another chart changes the numbers here too.
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / }).click();
  const newOnly = rows.filter((r) => r.segment === "new" && r.path.includes("Search")).length;
  await expect(section.getByText(new RegExp(`^${newOnly.toLocaleString("en-US")} of ${rows.filter((r) => r.segment === "new").length.toLocaleString("en-US")} customers did Search\.`))).toBeVisible();

  await section.getByText("How this view was worked out").click();
  await expect(section.getByText("is counted once, from the first", { exact: false }).or(section.getByText("Each is counted once, from the first", { exact: false })).first()).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("around one event fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByRole("region", { name: "Around one event" })).toBeVisible({ timeout: 180_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
