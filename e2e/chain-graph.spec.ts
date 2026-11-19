import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function load(page: import("@playwright/test").Page) {
  await page.goto("/insights");
  await page.getByRole("button", { name: "Load synthetic comments" }).click();
  await expect(page.getByRole("list", { name: "Evidence chain for Shipping costs too much" })).toBeVisible({ timeout: 120_000 });
}

test("on a laptop the chain is a graph of six links that the keyboard reaches, with the same words as the list", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await load(page);
  const graph = page.getByRole("group", { name: "Evidence chain graph for Shipping costs too much" });
  await expect(graph).toBeVisible();
  const nodes = graph.locator(".react-flow__node");
  await expect(nodes).toHaveCount(6);
  await expect(graph.locator(".react-flow__edge")).toHaveCount(5);

  const items = page.getByRole("list", { name: "Evidence chain for Shipping costs too much" }).getByRole("listitem");
  for (let i = 0; i < 6; i++) {
    const words = (await items.nth(i).locator("p").first().innerText()).trim();
    await expect(nodes.nth(i)).toContainText(words);
    await expect(nodes.nth(i)).toHaveAttribute("aria-label", new RegExp(`^${i + 1} of 6\\. `));
  }

  // Every link can be reached with Tab.
  await nodes.first().focus();
  const reached: string[] = [];
  for (let i = 0; i < 6; i++) {
    reached.push((await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).slice(0, 6));
    await page.keyboard.press("Tab");
  }
  expect(reached).toEqual(["1 of 6", "2 of 6", "3 of 6", "4 of 6", "5 of 6", "6 of 6"]);

  // Choosing another theme redraws the graph.
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("support_slow");
  await expect(page.getByRole("group", { name: "Evidence chain graph for Support was slow to answer" })).toBeVisible();

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("on a phone the graph is not drawn and the list is the chain", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await load(page);
  await expect(page.getByRole("group", { name: /Evidence chain graph/ })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Evidence chain for Shipping costs too much" }).getByRole("listitem")).toHaveCount(6);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
