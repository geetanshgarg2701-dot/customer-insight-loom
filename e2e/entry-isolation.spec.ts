import { expect, test } from "@playwright/test";
import { navTo } from "./nav-helper";

/**
 * Next keeps a visited page's React state across client navigation. Each
 * entry section is keyed by the entry id, so one entry's assignment result
 * and its download can never show up on another entry.
 */
test("a second entry never shows the first entry's assignment or its download", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/ledger");
  await page.getByLabel("Title", { exact: true }).fill("First entry");
  await page.getByLabel("Hypothesis").fill("H");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("link", { name: "First entry" }).click();

  const design = page.getByRole("region", { name: "Design and power check" });
  await design.getByLabel("Baseline conversion rate, percent").fill("30");
  await design.getByLabel("Smallest lift to detect, percentage points").fill("15");
  await design.getByLabel("Treatment share, percent").fill("50");
  await design.getByLabel("People available").fill("1000");
  await design.getByRole("button", { name: "Run power check" }).click();
  await design.getByRole("button", { name: "Register entry" }).click();
  await expect(page.getByText("Status: registered")).toBeVisible({ timeout: 30_000 });

  const assign = page.getByRole("region", { name: "Assignment" });
  const csv = ["email", ...Array.from({ length: 1000 }, (_, i) => `p${i}@example.com`)].join("\n") + "\n";
  await assign.getByLabel("Audience CSV").setInputFiles({ name: "a.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(assign.getByLabel("Email column")).toHaveValue("0", { timeout: 30_000 });
  await assign.getByRole("button", { name: "Assign audience" }).click();
  await expect(assign.getByText("Assigned 1000 people")).toBeVisible({ timeout: 60_000 });
  await expect(assign.getByRole("button", { name: "Download assignment file" })).toBeVisible();

  await navTo(page, "Ledger");
  await page.getByLabel("Title", { exact: true }).fill("Second entry");
  await page.getByLabel("Hypothesis").fill("H");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("link", { name: "Second entry" }).click();
  await expect(page.getByRole("heading", { name: "Second entry" })).toBeVisible({ timeout: 30_000 });

  await expect(assign.getByRole("button", { name: "Download assignment file" })).toHaveCount(0);
  await expect(assign.getByText(/Assigned \d+ people/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Design and power check" }).getByText(/Power check (passed|failed)/)).toHaveCount(0);
});
