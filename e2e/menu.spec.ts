import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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

test("the headline arrives line by line when motion is allowed and is simply there when it is not", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openHome(page);
  const animationOf = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);
  expect(await animationOf(".hero h1 .line")).toBe("line-up");
  expect(await animationOf(".hero-funnel svg")).toBe("fade-in");
  // The last line is lighter in weight and in color.
  const style = (selector: string) => page.locator(selector).evaluate((el) => ({ weight: getComputedStyle(el).fontWeight, color: getComputedStyle(el).color }));
  expect(await style(".hero h1 .light")).toEqual({ weight: "300", color: "rgb(90, 98, 112)" });
  expect(await style(".hero h1")).toEqual({ weight: "600", color: "rgb(21, 23, 27)" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animationOf(".hero h1 .line")).toBe("none");
  expect(await animationOf(".hero-funnel svg")).toBe("none");
});

test("the faded chart says the same counts as the Journeys screen, in text that does not fade", async ({ page }) => {
  await openHome(page);
  const picture = page.getByRole("img", { name: /Synthetic example/ });
  for (const n of ["100,000", "69,311", "35,519", "16,294"]) {
    await expect(picture).toHaveAccessibleName(new RegExp(n));
    await expect(page.locator(".hero-funnel dl")).toContainText(n);
  }
  expect(await page.locator(".hero-funnel dl").evaluate((el) => getComputedStyle(el).maskImage)).toBe("none");
});

test("the home screen has one dark pill, no glass, no glow and no left stripe", async ({ page }) => {
  await openHome(page);
  const found = await page.evaluate(() => {
    const dark = getComputedStyle(document.querySelector(".hero .button-link")!).backgroundColor;
    const out = { pills: 0, glass: 0, shadow: 0, stripe: 0, gradient: 0 };
    for (const el of document.querySelectorAll("body *:not(nextjs-portal)")) {
      for (const pseudo of [null, "::before"]) {
        const s = getComputedStyle(el, pseudo);
        if (s.backdropFilter !== "none") out.glass++;
        if (s.boxShadow !== "none" && !s.boxShadow.includes("inset")) out.shadow++;
        if (parseFloat(s.borderLeftWidth) > parseFloat(s.borderTopWidth)) out.stripe++;
        if (s.backgroundImage.includes("gradient")) out.gradient++;
      }
      if ((el.tagName === "A" || el.tagName === "BUTTON") && el.getClientRects().length > 0 && getComputedStyle(el).backgroundColor === dark) out.pills++;
    }
    return out;
  });
  // The closed tour card and the closed menus carry a soft shadow, and none of them is on show.
  const shadowsOnShow = await page.evaluate(() => [...document.querySelectorAll("main *, nav *")].filter((el) => el.getClientRects().length > 0 && !["none"].includes(getComputedStyle(el).boxShadow) && !getComputedStyle(el).boxShadow.includes("inset")).length);
  expect({ ...found, shadow: shadowsOnShow }).toEqual({ pills: 1, glass: 0, shadow: 0, stripe: 0, gradient: 0 });
});

test("the dark look follows the system setting, and the home screen and menu pass axe in it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openHome(page);
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(14, 16, 18)");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Customers", exact: true }).click();
  await page.waitForTimeout(1200);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});

for (const path of ["/ledger", "/intake", "/compliance", "/drafts", "/ingest", "/data", "/check", "/insights", "/pipeline", "/journeys", "/methods", "/privacy", "/terms", "/no-such-page"]) {
  test(`${path} passes axe in the dark look`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}

test("the hero and the open menu have no axe violations", async ({ page }) => {
  await openHome(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Your data", exact: true }).click();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
