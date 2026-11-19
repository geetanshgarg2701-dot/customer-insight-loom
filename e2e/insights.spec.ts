import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys } from "../src/lib/demo/journeys";
import { syntheticComments } from "../src/lib/insights/comments";
import { prepareComments } from "../src/lib/insights/prepare";

const journeys = syntheticJourneys(20_000, 11);
const comments = syntheticComments(journeys, 3_000, 17);
const prepared = prepareComments(comments);
const n = (v: number) => v.toLocaleString("en-US");
const pct = (x: number) => `${(x * 100).toFixed(1)} percent`;

async function load(page: import("@playwright/test").Page) {
  await page.goto("/insights");
  await page.getByRole("button", { name: "Load synthetic comments" }).click();
  await expect(page.getByRole("heading", { name: "Redaction scorecard" })).toBeVisible({ timeout: 120_000 });
}

test("the scorecard, the shares and the quotes match the generator, and no planted detail reaches the page", async ({ page }) => {
  test.setTimeout(180_000);
  await load(page);

  const card = page.getByRole("table", { name: "Planted details against what redaction caught" });
  const emails = card.getByRole("row", { name: /^Emails/ }).getByRole("cell");
  await expect(emails.nth(0)).toHaveText(n(prepared.scorecard.email.planted));
  await expect(emails.nth(2)).toHaveText("0");
  const names = card.getByRole("row", { name: /^Personal names/ }).getByRole("cell");
  await expect(names.nth(1)).toHaveText("Not covered by the rules");
  await expect(names.nth(2)).toHaveText(n(prepared.scorecard.name.planted));
  await expect(page.getByText(`${n(prepared.rows.length)} comments were kept and ${n(prepared.withheld)} were withheld`, { exact: false })).toBeVisible();

  // Shipping cost among customers who left at the Cart, counted here in plain code.
  const cart = prepared.rows.filter((r) => r.reached === "Cart");
  const share = cart.filter((r) => r.pain === "shipping_cost").length / cart.length;
  const table = page.getByRole("table", { name: /Share of comments mentioning each pain/ });
  await expect(table.getByRole("columnheader", { name: `Cart, ${n(cart.length)}` })).toBeVisible();
  const headers = await table.getByRole("columnheader").allInnerTexts();
  const cartColumn = headers.findIndex((h) => h.startsWith("Cart,"));
  const shipping = table.getByRole("row", { name: /^Shipping costs too much/ }).getByRole("cell").nth(cartColumn - 1);
  await expect(shipping).toContainText(pct(share));

  // Grouping by Support uses the journeys table.
  await page.getByLabel("Group by").selectOption("support");
  const used = prepared.rows.filter((r) => journeys[r.customer].path.includes("Support")).length;
  await expect(table.getByRole("columnheader", { name: `used Support, ${n(used)}` })).toBeVisible();

  // The first page of quotes is the first ten shipping cost comments by customer.
  const first = prepared.rows.filter((r) => r.pain === "shipping_cost").sort((a, b) => a.customer - b.customer)[0];
  await expect(page.getByRole("blockquote").first()).toHaveText(first.quote.text);

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("example.invalid");
  expect(body).not.toContain("4242 4242");
  expect(body).not.toMatch(/555-01\d\d/);
});

test("a correction is redacted again before it is stored and shown", async ({ page }) => {
  test.setTimeout(180_000);
  await load(page);
  const first = prepared.rows.filter((r) => r.pain === "shipping_cost").sort((a, b) => a.customer - b.customer)[0];
  await page.getByRole("button", { name: `Correct the comment from customer ${first.customer}` }).click();
  const box = page.getByLabel(`Corrected text for customer ${first.customer}`);
  await box.fill("Shipping was too much. Write to me at someone@example.invalid.");
  await page.getByRole("button", { name: "Save and redact again" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. The edited text was redacted again and 1 detail was removed.");
  await expect(page.getByRole("blockquote").first()).toHaveText("Shipping was too much. Write to me at [EMAIL].");
  expect(await page.locator("body").innerText()).not.toContain("example.invalid");
});

test("the comments screen has no axe violations and fits a phone once loaded", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  await page.getByText("How the shares were worked out").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
