import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated accessibility checks with axe-core, against WCAG 2.0 and 2.1 levels A and AA. Read this carefully:
 * a clean run means axe found no confirmed violation on that screen. It does not mean the screen is accessible.
 * Automated tools catch only part of the problems, and axe lists the rest as "incomplete", needs a person to judge.
 * Those are counted and printed here, not hidden, and they are not counted as passes.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // The framework's development badge is not part of the app and does not exist in a production build.
    .exclude("nextjs-portal")
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    ")}`,
  );
  console.log(`axe ${where}: ${results.violations.length} violations, ${results.incomplete.length} needs review`);
  for (const i of results.incomplete) console.log(`  needs review: ${i.id}, ${i.nodes.length} elements`);
  expect(summary, `${where} has accessibility violations:\n${summary.join("\n")}`).toEqual([]);
}

test.describe("static screens", () => {
  for (const path of ["/", "/intake", "/ledger", "/journeys", "/pipeline", "/methods", "/privacy", "/terms", "/no-such-page"]) {
    test(`${path} has no confirmed axe violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await scan(page, path);
    });
  }
});

test("the journeys screen has none with data loaded and a filter chosen", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / }).click();
  await expect(page.getByText(/Showing (?!100,000 of)[\d,]+ of 100,000 customers/)).toBeVisible();
  await page.waitForTimeout(800);
  await scan(page, "/journeys with data");
});

test("the pipeline screen has none with data loaded and a filter chosen", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/pipeline");
  await page.getByRole("button", { name: "Load synthetic pipeline" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 deals/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^enterprise, / }).click();
  await page.waitForTimeout(800);
  await scan(page, "/pipeline with data");
});

test("the ledger and an entry have none, with the demo loaded and an explanation open", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 3 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await scan(page, "/ledger with entries");
  await page.getByRole("table", { name: "Ledger entries" }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  await page.getByText("How these numbers were worked out").first().click();
  await page.waitForTimeout(500);
  await scan(page, "/ledger/entry with an explanation open");
});

// Keyboard use. axe cannot test this, so it is tested here directly.

/** The accessible name of whatever has focus, or an empty string. */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "";
    return (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ");
  });
}

test("keyboard only: Tab visits every control once and does not get trapped", async ({ page }) => {
  await page.goto("/privacy");
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const name = await focusedName(page);
    if (name === "" || seen.includes(name)) break;
    seen.push(name);
  }
  // Navigation first, then the footer, in page order, and the loop ended instead of running forever.
  expect(seen.slice(0, 5)).toEqual(["Home", "Data intake", "Ledger", "Journeys", "Pipeline"]);
  expect(seen).toContain("Privacy");
  expect(seen[seen.length - 1]).toBe("Terms");
  expect(seen.length).toBeLessThan(40);
});

test("keyboard only: a chart filter can be reached, shows focus, and toggles with Space and Enter", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/journeys");
  await page.keyboard.press("Tab");
  // The Load button is reached by keyboard and started with Enter.
  for (let i = 0; i < 12 && (await focusedName(page)) !== "Load synthetic journeys"; i++) await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("Load synthetic journeys");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });

  // Tab on to the first segment filter.
  let reached = false;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    if (/^new, /.test(await focusedName(page))) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);

  // The focus ring is drawn: a visible outline, at least 2 pixels wide.
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);

  const filter = page.getByRole("group", { name: "Filter by segment" }).getByRole("button", { name: /^new, / });
  await page.keyboard.press("Space");
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/Showing (?!100,000 of)[\d,]+ of 100,000 customers/)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(filter).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible();
});

test("every chart has the same information as text, so nothing depends on seeing the picture", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  // Each bar chart is matched by buttons that carry its numbers, and the flow chart by a table.
  for (const group of ["Filter by channel", "Filter by segment", "Filter by furthest step reached"]) {
    const buttons = page.getByRole("group", { name: group }).getByRole("button");
    expect(await buttons.count()).toBeGreaterThan(1);
    for (const text of await buttons.allInnerTexts()) expect(text).toMatch(/, [\d,]+$/);
  }
  expect(await page.getByRole("table", { name: "Flow between steps" }).getByRole("row").count()).toBeGreaterThan(3);
  // The canvas itself is named by its figure, so a screen reader announces what it is.
  expect(await page.getByRole("figure").count()).toBe(4);
});

test("charts draw at once when the system asks to reduce motion, and follow the setting live", async ({ page }) => {
  test.setTimeout(240_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/journeys");
  await page.getByRole("button", { name: "Load synthetic journeys" }).click();
  await expect(page.getByText(/Showing 100,000 of 100,000 customers/)).toBeVisible({ timeout: 180_000 });
  const figures = page.getByRole("figure");
  await expect(figures).toHaveCount(4);
  for (const figure of await figures.all()) await expect(figure).toHaveAttribute("data-motion", "off");
  // Changing the system setting takes effect without a reload.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const figure of await figures.all()) await expect(figure).toHaveAttribute("data-motion", "on");
});

test("with every explanation open, the pipeline and journeys screens still have no axe violations", async ({ page }) => {
  test.setTimeout(240_000);
  for (const [path, button, ready] of [
    ["/journeys", "Load synthetic journeys", /Showing 100,000 of 100,000 customers/],
    ["/pipeline", "Load synthetic pipeline", /Showing 100,000 of 100,000 deals/],
  ] as const) {
    await page.goto(path);
    await page.getByRole("button", { name: button }).click();
    await expect(page.getByText(ready)).toBeVisible({ timeout: 180_000 });
    for (const summary of await page.locator("summary").all()) await summary.click();
    await page.waitForTimeout(500);
    await scan(page, `${path} with every explanation open`);
  }
});
