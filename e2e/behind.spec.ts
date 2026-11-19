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
