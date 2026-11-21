import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("an idea starts a draft with brackets to fill, shows how to use it honestly, and the filled draft reaches the ledger", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/ledger");
  const section = page.getByRole("region", { name: "New entry" });
  const title = section.getByLabel("Title", { exact: true });
  const hypothesis = section.getByRole("textbox", { name: /^Hypothesis/ });

  await section.getByLabel("Behavioral idea").selectOption("scarcity");
  await expect(title).toHaveValue("Low stock notice for [segment]");
  await expect(hypothesis).toHaveValue(/^If we tell \[segment\] that \[item\] is low in stock, then more of them will buy it within the conversion window than the holdout, because/);
  await expect(section.getByText("Say low stock or a deadline only when it is true.")).toBeVisible();
  await expect(section.getByText("Purchases of the item within the conversion window.")).toBeVisible();
  await expect(section.getByText(/It is not evidence that it works, and it says nothing about how much\./)).toBeVisible();
  await expect(section.getByRole("status")).toContainText("Still to fill in the Title or Hypothesis: segment, item.");

  await section.getByLabel("Segment", { exact: true }).fill("new customers");
  await section.getByLabel("Item", { exact: true }).fill("the blue backpack");
  await section.getByRole("button", { name: "Fill in the brackets" }).click();
  await expect(title).toHaveValue("Low stock notice for new customers");
  await expect(hypothesis).toHaveValue(/^If we tell new customers that the blue backpack is low in stock/);
  await expect(section.getByRole("status")).toHaveCount(0);

  await section.getByRole("button", { name: "Create draft" }).click();
  const table = page.getByRole("table", { name: "Ledger entries" });
  await expect(table.getByRole("link", { name: "Low stock notice for new customers" })).toBeVisible({ timeout: 60_000 });
  await table.getByRole("link", { name: "Low stock notice for new customers" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Low stock notice for new customers" })).toBeVisible();
  await expect(page.getByText(/If we tell new customers that the blue backpack is low in stock/)).toBeVisible();
});

test("choosing no idea leaves the form as it was, and a half filled draft is flagged", async ({ page }) => {
  await page.goto("/ledger");
  const section = page.getByRole("region", { name: "New entry" });
  await section.getByLabel("Behavioral idea").selectOption("social-proof");
  await section.getByLabel("Segment", { exact: true }).fill("returning customers");
  await section.getByRole("button", { name: "Fill in the brackets" }).click();
  await expect(section.getByRole("status")).toContainText("Still to fill in the Title or Hypothesis: item.");
  await section.getByLabel("Behavioral idea").selectOption("");
  // Choosing none does not wipe what is in the form.
  await expect(section.getByLabel("Title", { exact: true })).toHaveValue("Customer count in the email to returning customers");
});

test("the picker has no axe violations and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/ledger");
  await page.getByLabel("Behavioral idea").selectOption("loss-aversion");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
