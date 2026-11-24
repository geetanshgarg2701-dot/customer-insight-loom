import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { syntheticJourneys } from "../src/lib/demo/journeys";

const rows = syntheticJourneys(100_000, 11);
const n = (v: number) => v.toLocaleString("en-US");
const entered = (step: string) => rows.filter((r) => r.path.includes(step)).length;
const endedAt = (step: string) => rows.filter((r) => r.path.includes(step) && r.path[r.path.length - 1] === step).length;

async function load(page: import("@playwright/test").Page) {
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
}

test("the designed journey shows the generator's live numbers on every step, opens a step on click, and warns about loops", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Designed journey" });

  // Each step shows its name and its count, and every number is in its accessible name too.
  const cart = section.getByRole("group", { name: /^Cart, main step\./ });
  await expect(cart).toContainText(n(entered("Cart")));
  await expect(cart).toHaveAttribute("aria-label", new RegExp(`Entered ${n(entered("Cart"))}`));
  const search = section.getByRole("group", { name: /^Search, detour\./ });
  await expect(search).toContainText(n(entered("Search")));
  await expect(search).toHaveAttribute("aria-label", new RegExp(`Entered ${n(entered("Search"))}, went on .*, ended here ${n(endedAt("Search"))}`));

  // The table version has the same numbers.
  await section.getByText("Show as table").click();
  const steps = section.getByRole("table", { name: "Designed journey steps" });
  await expect(steps.getByRole("row", { name: /^Support / })).toContainText(n(entered("Support")));
  await expect(steps.getByRole("row", { name: /^Cart / })).toContainText(n(endedAt("Cart")));
  await expect(steps.getByRole("row", { name: /^Search / })).toContainText("not measured");
  const edges = section.getByRole("table", { name: "Designed journey connections" });
  const cartToPurchase = rows.filter((r) => r.path.some((s, i) => s === "Cart" && r.path[i + 1] === "Purchase")).length;
  await expect(edges.getByRole("row", { name: /^Cart Purchase / })).toContainText(n(cartToPurchase));

  // Selecting a main step opens who is behind it below.
  await cart.click();
  await expect(section.getByText("Opened who is behind Cart, below under Behind a step.")).toBeVisible();
  const atCart = rows.filter((r) => r.steps[2] !== null).length;
  await expect(page.getByRole("region", { name: "Behind a step" }).getByText(new RegExp(`^${n(atCart)} people reached Cart\.`))).toBeVisible();

  // A detour opens who is behind it too, counted from the full path.
  await search.click();
  await expect(section.getByText("Opened who is behind the Search detour, below under Behind a step.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Behind a step" }).getByText(new RegExp(`^${n(entered("Search"))} people reached Search\.`))).toBeVisible();

  // A sketched connection that makes a loop is flagged, a harmless one is not.
  await section.getByRole("combobox", { name: "From step" }).selectOption("Cart");
  await section.getByRole("combobox", { name: "To step" }).selectOption("Product");
  await section.getByRole("button", { name: "Add connection to the sketch" }).click();
  await expect(section.getByRole("alert").filter({ hasText: "This connection makes a loop: Cart to Product." })).toBeVisible();
  await section.getByRole("combobox", { name: "From step" }).selectOption("Visit");
  await section.getByRole("combobox", { name: "To step" }).selectOption("Cart");
  await section.getByRole("button", { name: "Add connection to the sketch" }).click();
  await expect(section.getByRole("status").filter({ hasText: "Added Visit to Cart to the sketch." })).toBeVisible();
  await section.getByRole("button", { name: "Add connection to the sketch" }).click();
  await expect(section.getByText("Visit to Cart is already on the canvas.")).toBeVisible();
  await section.getByRole("button", { name: "Clear the sketch" }).click();
  await expect(section.getByRole("button", { name: "Clear the sketch" })).toBeDisabled();
});

test("the designed journey follows the filters", async ({ page }) => {
  test.setTimeout(240_000);
  await load(page);
  const section = page.getByRole("region", { name: "Designed journey" });
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / }).click();
  const fresh = rows.filter((r) => r.segment === "new");
  const e = fresh.filter((r) => r.path.includes("Cart")).length;
  await expect(section.getByRole("group", { name: /^Cart, main step\./ })).toHaveAttribute("aria-label", new RegExp(`Entered ${n(e)}`));
});

test("the designed journey can be reached from the keyboard, has no axe violations, and the page fits a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  const section = page.getByRole("region", { name: "Designed journey" });
  const cart = section.getByRole("group", { name: /^Cart, main step\./ });
  await cart.focus();
  await page.keyboard.press("Enter");
  await expect(section.getByText("Opened who is behind Cart, below under Behind a step.")).toBeVisible();
  await section.getByText("How the designed journey was worked out").click();
  await expect(section.getByText("every move customers made", { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
