import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys } from "../src/lib/demo/journeys";
import { syntheticComments } from "../src/lib/insights/comments";
import { prepareComments } from "../src/lib/insights/prepare";

const journeys = syntheticJourneys(100_000, 11);
const prepared = prepareComments(syntheticComments(journeys.slice(0, 20_000), 3_000, 17));
const n = (v: number) => v.toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)} percent`;

async function open(page: import("@playwright/test").Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  const section = page.getByRole("region", { name: "Why people may leave here" });
  await section.getByRole("button", { name: "Show what goes with leaving here" }).click();
  await expect(section.getByText(/comparisons were made and adjusted together/)).toBeVisible({ timeout: 60_000 });
  return section;
}

test("the why panel matches an independent count at the Cart, lists shipping cost with redacted quotes, and follows the step and filters", async ({ page }) => {
  test.setTimeout(300_000);
  const section = await open(page);

  const atCart = journeys.filter((j) => j.steps[2] !== null);
  const leftCart = atCart.filter((j) => j.steps[3] === null).length;
  const commenters = prepared.rows.filter((r) => journeys[r.customer].steps[2] !== null);
  const left = commenters.filter((r) => journeys[r.customer].steps[3] === null);
  const wentOn = commenters.filter((r) => journeys[r.customer].steps[3] !== null);
  await expect(section.getByText(`${n(atCart.length)} people reached Cart and ${n(leftCart)} left there.`, { exact: false })).toBeVisible();
  await expect(section.getByText(`${n(left.length)} who left and ${n(wentOn.length)} who went on wrote a comment.`, { exact: false })).toBeVisible();

  const list = section.getByRole("list", { name: "What goes with leaving at Cart" });
  const ship = list.getByRole("listitem").filter({ hasText: "Theme: Shipping costs too much" });
  const a = left.filter((r) => r.pain === "shipping_cost").length / left.length;
  const b = wentOn.filter((r) => r.pain === "shipping_cost").length / wentOn.length;
  await expect(ship).toContainText(`${pct(a)} of the ${n(left.length)} who left and commented raised it, against ${pct(b)} of the ${n(wentOn.length)} who went on.`);
  await expect(ship).toContainText("Association, not cause.");
  await ship.getByText("Redacted quotes from customers who left here").click();
  const firstQuote = left.filter((r) => r.pain === "shipping_cost").sort((x, y) => x.customer - y.customer)[0];
  await expect(ship.getByRole("blockquote").first()).toContainText(firstQuote.quote.text);

  // Choosing another step in Behind a step moves the panel with it.
  await page.getByRole("group", { name: "Step to look behind" }).getByRole("button", { name: "Purchase" }).click();
  await expect(section.getByText("Purchase is the last step, so nobody leaves it.", { exact: false })).toBeVisible();
  await page.getByRole("group", { name: "Step to look behind" }).getByRole("button", { name: "Cart" }).click();
  await expect(list).toBeVisible();

  // A filter applies to the panel too.
  await page.getByRole("group", { name: "Filter by channel" }).getByRole("button", { name: /^email, / }).click();
  const emailAtCart = atCart.filter((j) => j.channel === "email");
  await expect(section.getByText(`${n(emailAtCart.length)} people reached Cart and`, { exact: false })).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("example.invalid");
  expect(body).not.toMatch(/555-01\d\d/);
});

test("the why panel has no axe violations and fits a phone", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const section = await open(page);
  await section.getByText("How what goes with leaving was worked out").click();
  await section.getByText("Redacted quotes from customers who left here").first().click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='h-why']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
