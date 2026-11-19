import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const bought = rows.map((r, i) => ({ r, i })).filter((x) => x.r.reached === "Purchase");

async function load(page: import("@playwright/test").Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
}

test("replay shows the generator's first customer who bought, steps through it, and moves to the next customer", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Replay one path" });
  const first = bought[0];
  await expect(section.getByText(`Synthetic customer ${first.i}, ${first.r.segment} segment, ${first.r.channel} channel.`)).toBeVisible();
  await expect(section.getByText(new RegExp(`Customer 1 of ${bought.length.toLocaleString("en-US")} who match`))).toBeVisible();

  // By default every event is shown, in the generator's order, with detours.
  const table = section.getByRole("table", { name: "Replay one path" });
  await expect(table.getByRole("row")).toHaveCount(first.r.path.length + 1);
  for (let i = 0; i < first.r.path.length; i++) {
    await expect(table.getByRole("row").nth(i + 1).getByRole("cell").nth(1)).toHaveText(first.r.path[i]);
    const utc = first.r.times[i].replace("T", " ").slice(0, 16) + " UTC";
    await expect(table.getByRole("row").nth(i + 1).getByRole("cell").nth(2)).toHaveText(utc);
  }

  // Replaying from the start shows one event, and Next reveals them one at a time.
  await section.getByRole("button", { name: "Replay from the start" }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(section.getByText(`Event 1 of ${first.r.path.length}: Visit, 0 minutes after entry.`)).toBeVisible();
  await section.getByRole("button", { name: "Next event" }).click();
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(section.getByRole("button", { name: "Previous event" })).toBeEnabled();

  // Another customer, in the generator's fixed order.
  const second = bought[1];
  await section.getByRole("button", { name: "Show another customer" }).click();
  await expect(section.getByText(`Synthetic customer ${second.i}, ${second.r.segment} segment`)).toBeVisible();

  // A different outcome, and the other filters apply.
  await section.getByRole("group", { name: "Customers who" }).getByRole("button", { name: "Left at Cart" }).click();
  const leftAtCart = rows.map((r, i) => ({ r, i })).filter((x) => x.r.reached === "Cart")[0];
  await expect(section.getByText(`Synthetic customer ${leftAtCart.i},`)).toBeVisible();
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^vip, / }).click();
  const vipLeft = rows.map((r, i) => ({ r, i })).filter((x) => x.r.reached === "Cart" && x.r.segment === "vip")[0];
  await expect(section.getByText(`Synthetic customer ${vipLeft.i}, vip segment`)).toBeVisible();

  // No address and no real name is ever shown.
  expect(await page.locator("body").innerText()).not.toMatch(/@/);
});

test("replay can be driven from the keyboard, has no axe violations, and fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  const section = page.getByRole("region", { name: "Replay one path" });
  await section.getByRole("button", { name: "Replay from the start" }).click();
  const slider = section.getByRole("slider", { name: "Event shown" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(section.getByText(/^Event 2 of \d+:/)).toBeVisible();
  await section.getByText("How this replay was worked out").click();
  await expect(section.getByText("no email or name", { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
