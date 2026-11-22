import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { navTo } from "./nav-helper";

test("an entry that names a theme shows up as the test link in that theme's evidence chain, and can be retargeted while a draft", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/ledger");
  // The in-browser ledger starts its database first. Under a full parallel run that can take a while.
  await expect(page.getByText("No entries yet.", { exact: false })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Title").fill("Free shipping over 50 dollars");
  await page.getByLabel("Hypothesis").fill("Free shipping over 50 dollars lifts Cart to Purchase against a holdout.");
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption({ label: "Shipping costs too much" });
  await page.getByRole("button", { name: "Create draft" }).click();
  const link = page.getByRole("link", { name: "Free shipping over 50 dollars" });
  await expect(link).toBeVisible();

  // Client side links keep the in-browser ledger, so the comments screen can read it.
  await navTo(page, "Comments");
  await page.getByRole("button", { name: "Load synthetic comments" }).click();
  const chain = page.getByRole("list", { name: "Evidence chain for Shipping costs too much" });
  await expect(chain).toBeVisible({ timeout: 120_000 });
  const testStep = chain.getByRole("listitem").nth(4);
  await expect(testStep).toContainText("Free shipping over 50 dollars, draft.");
  await expect(testStep).not.toContainText("Missing");
  await expect(chain.getByRole("listitem").nth(5)).toContainText("No decision.");

  // Another theme's chain does not pick it up.
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("pricing");
  await expect(page.getByRole("list", { name: "Evidence chain for Price feels too high" }).getByRole("listitem").nth(4)).toContainText(
    "No ledger entry names this theme yet.",
  );

  // Open the entry from the chain and move it to pricing while it is still a draft.
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("shipping_cost");
  await chain.getByRole("link", { name: "Open the ledger entry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Free shipping over 50 dollars" })).toBeVisible();
  const themeBox = page.getByRole("combobox", { name: "Theme", exact: true });
  await expect(themeBox.locator("option:checked")).toHaveText("Shipping costs too much");
  await themeBox.selectOption({ label: "Price feels too high" });
  await expect(themeBox.locator("option:checked")).toHaveText("Price feels too high");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
