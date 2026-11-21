import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const n = (v: number) => v.toLocaleString("en-US");

async function load(page: import("@playwright/test").Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
}

test("behind a step shows the generator's groups, follows the step buttons and filters, and shows no person", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Behind a step" });
  const table = section.getByRole("table", { name: "Behind a step" });

  // Cart is the default, where the planted leak is.
  const atCart = rows.filter((r) => r.steps[2] !== null);
  const bought = atCart.filter((r) => r.steps[3] !== null).length;
  await expect(section.getByText(`${n(atCart.length)} people reached Cart. ${n(bought)} went on to Purchase and ${n(atCart.length - bought)} left at Cart.`)).toBeVisible();
  const newAds = atCart.filter((r) => r.segment === "new" && r.channel === "ads");
  const row = table.getByRole("row", { name: /^new, ads / });
  await expect(row.getByRole("cell").nth(1)).toHaveText(n(newAds.length));
  await expect(row.getByRole("cell").nth(2)).toHaveText(n(newAds.filter((r) => r.steps[3] !== null).length));

  // The last step has nothing to go on to.
  await section.getByRole("group", { name: "Step to look behind" }).getByRole("button", { name: "Purchase" }).click();
  await expect(section.getByText(/It is the last step, so nobody goes on from here\./)).toBeVisible();

  // The other filters apply.
  await section.getByRole("group", { name: "Step to look behind" }).getByRole("button", { name: "Product" }).click();
  await page.getByRole("group", { name: "Filter by channel" }).getByRole("button", { name: /^email, / }).click();
  const emailAtProduct = rows.filter((r) => r.channel === "email" && r.steps[1] !== null);
  await expect(section.getByText(new RegExp(`^${n(emailAtProduct.length)} people reached Product\.`))).toBeVisible();

  // No synthetic address or single person is ever on the page.
  expect(await page.locator("body").innerText()).not.toContain("example.invalid");
});

/** Counts for a detour straight from the generated paths: the first visit, the very next event, or the last event. */
function detourCounts(list: typeof rows, step: string, next: string) {
  let reached = 0;
  let movedOn = 0;
  let left = 0;
  for (const r of list) {
    const i = r.path.indexOf(step);
    if (i < 0) continue;
    reached++;
    if (i === r.path.length - 1) left++;
    else if (r.path[i + 1] === next) movedOn++;
  }
  return { reached, movedOn, left, elsewhere: reached - movedOn - left };
}

test("a detour opens who is behind it, from the full path, follows the filters, and the why panel says it stays on a main step", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Behind a step" });
  const picker = section.getByRole("group", { name: "Step to look behind" });

  await picker.getByRole("button", { name: "Support" }).click();
  await expect(picker.getByRole("button", { name: "Support" })).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("button", { name: "Cart" })).toHaveAttribute("aria-pressed", "false");
  const s = detourCounts(rows, "Support", "Purchase");
  const tail = s.elsewhere > 0 ? ` ${n(s.elsewhere)} went somewhere the design does not show.` : "";
  await expect(section.getByText(`${n(s.reached)} people reached Support. ${n(s.movedOn)} went on to Purchase and ${n(s.left)} left at Support.${tail}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Why people may leave here" }).getByText("This panel covers the four main steps, so it still shows Cart while the Support detour is open above.")).toBeVisible();

  // A filter keeps the detour open and recounts it.
  await page.getByRole("group", { name: "Filter by channel" }).getByRole("button", { name: /^email, / }).click();
  const e = detourCounts(rows.filter((r) => r.channel === "email"), "Support", "Purchase");
  await expect(section.getByText(new RegExp(`^${n(e.reached)} people reached Support\. ${n(e.movedOn)} went on to Purchase`))).toBeVisible();

  // Search, then back to a main step.
  await picker.getByRole("button", { name: "Search" }).click();
  const q = detourCounts(rows.filter((r) => r.channel === "email"), "Search", "Product");
  await expect(section.getByText(new RegExp(`^${n(q.reached)} people reached Search\. ${n(q.movedOn)} went on to Product`))).toBeVisible();
  await picker.getByRole("button", { name: "Cart" }).click();
  const cart = rows.filter((r) => r.channel === "email" && r.steps[2] !== null).length;
  await expect(section.getByText(new RegExp(`^${n(cart)} people reached Cart\.`))).toBeVisible();
  await expect(page.getByText(/This panel covers the four main steps/)).toHaveCount(0);
});

test("behind a step has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  const section = page.getByRole("region", { name: "Behind a step" });
  await section.getByText("How who is behind a step was worked out").click();
  await expect(section.getByText("No individual person", { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
