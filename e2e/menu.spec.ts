import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** The tour opens by itself on the first visit. These tests are about the menu and the hero, so they close it first. */
async function openHome(page: Page) {
  await page.goto("/");
  const tour = page.getByRole("dialog");
  await expect(tour).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
}

test("a group opens as a small menu, closes with Escape and puts focus back, and one group is open at a time", async ({ page }) => {
  await openHome(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  const experiments = nav.getByRole("button", { name: "Experiments", exact: true });
  const customers = nav.getByRole("button", { name: "Customers", exact: true });

  await expect(experiments).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Ledger", exact: true })).toBeHidden();

  await experiments.click();
  await expect(experiments).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Ledger", "Email check", "Email drafts"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();

  // Another group takes over.
  await customers.click();
  await expect(experiments).toHaveAttribute("aria-expanded", "false");
  await expect(customers).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link", { name: "Journeys", exact: true })).toBeVisible();

  // Escape, pressed with focus on a link inside the menu, closes it and sends focus back to the button that opened it.
  await nav.getByRole("link", { name: "Journeys", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(customers).toHaveAttribute("aria-expanded", "false");
  await expect(customers).toBeFocused();

  // A click elsewhere closes it too.
  await experiments.click();
  await page.getByRole("main").click({ position: { x: 5, y: 300 } });
  await expect(experiments).toHaveAttribute("aria-expanded", "false");
});

test("the menu works from the keyboard, and choosing a screen closes it and marks the group", async ({ page }) => {
  await openHome(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  const customers = nav.getByRole("button", { name: "Customers", exact: true });
  await customers.focus();
  await page.keyboard.press("Enter");
  await expect(customers).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(nav.getByRole("link", { name: "Journeys", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  await expect(customers).toHaveAttribute("aria-expanded", "false");
  // The group that holds the current screen is marked, and so is the screen itself once the group is opened.
  await expect(nav.locator('li[data-current="true"] > button')).toHaveText("Customers");
  await customers.click();
  await expect(nav.getByRole("link", { name: "Pipeline", exact: true })).toHaveAttribute("aria-current", "page");
});

test("on a phone the whole menu folds behind one Menu button, with the groups listed flat", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openHome(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  const menu = nav.getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(nav.getByRole("link", { name: "Ledger", exact: true })).toBeHidden();
  await expect(nav.getByRole("button", { name: "Experiments" })).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Home", "Ledger", "Email check", "Journeys", "Pipeline", "Comments", "Data intake", "Your data", "Methods"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await nav.getByRole("link", { name: "Pipeline", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("the home hero animates when motion is allowed and is simply there when it is not", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openHome(page);
  const animationOf = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);
  expect(await animationOf(".hero h1 .line > span")).toBe("line-up");
  expect(await animationOf(".layer.l4")).toBe("layer-in");
  expect(await animationOf("nav.topnav")).toBe("drop-in");
  // The numbers end on their real values.
  await expect.poll(() => page.locator(".hero-stats .count").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--n").trim()), { timeout: 8000 }).toBe("100");
  await expect.poll(() => page.locator(".hero-stats .count").nth(1).evaluate((el) => getComputedStyle(el).getPropertyValue("--n").trim()), { timeout: 8000 }).toBe("95");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animationOf(".hero h1 .line > span")).toBe("none");
  expect(await animationOf(".layer.l4")).toBe("none");
  expect(await animationOf("nav.topnav")).toBe("none");
  expect(await animationOf(".hero-stats .count")).toBe("none");
  expect(await page.locator(".hero-stats .count").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--n").trim())).toBe("100");
  // A screen reader hears the real figures, not the counting.
  await expect(page.locator(".hero-stats")).toContainText("100,000");
  await expect(page.locator(".hero-stats")).toContainText("95 percent");
});

test("the hero and the open menu have no axe violations", async ({ page }) => {
  await openHome(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Your data", exact: true }).click();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
