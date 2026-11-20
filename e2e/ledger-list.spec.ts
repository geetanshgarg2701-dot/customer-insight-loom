import fs from "node:fs";
import { expect, test } from "@playwright/test";

test("the ledger list can be filtered, searched and cleared, and says how many it shows", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });

  const table = page.getByRole("table", { name: "Ledger entries" });
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(page.getByText("Showing 4 of 4 entries.")).toBeVisible();

  // Type: only the matching entries are shown, fewer than all, and every one of them is of that type.
  await page.getByLabel(/^Type/).selectOption("exploratory");
  const shown = async () => Number(/Showing (\d+) of 4 entries\./.exec(await page.getByText(/^Showing \d+ of 4 entries\./).innerText())![1]);
  await expect.poll(shown).toBeLessThan(4);
  expect(await shown()).toBeGreaterThan(0);
  const rows = table.getByRole("row");
  expect(await rows.count()).toBe((await shown()) + 1);
  for (const row of (await rows.all()).slice(1)) await expect(row).toContainText("Exploratory");

  // Combined with a status that none of them has, nothing matches, and the page says so.
  await page.getByLabel(/^Status/).selectOption("closed");
  await expect(page.getByText("Showing 0 of 4 entries.")).toBeVisible();
  await expect(page.getByText("No entry matches these filters.")).toBeVisible();
  await expect(table).toHaveCount(0);

  // Clear brings everything back.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("Showing 4 of 4 entries.")).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeDisabled();

  // Search ignores case, and treats characters that mean something in a pattern as plain text.
  await page.getByLabel(/^Search/).fill("SYNTHETIC");
  await expect(page.getByText(/Showing [1-4] of 4 entries\./)).toBeVisible();
  await page.getByLabel(/^Search/).fill("(.*");
  await expect(page.getByText("Showing 0 of 4 entries.")).toBeVisible();
});

test("the CSV export has one row per entry, holds no address, and protects a formula title", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/ledger");
  // A title that starts like a spreadsheet formula, as a person might paste by accident or on purpose.
  await page.getByLabel("Title", { exact: true }).fill("=HYPERLINK(\"http://x.example\",\"click\")");
  await page.getByLabel("Hypothesis").fill("+cmd, with a comma");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("table", { name: "Ledger entries" })).toBeVisible({ timeout: 60_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export as CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^evidence-ledger-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = fs.readFileSync((await download.path())!, "utf8");
  const lines = text.split("\r\n");
  expect(lines[0]).toBe(
    "id,title,hypothesis,status,entry_type,framework_tag,registered_at,launched_at,source,comparisons_count,correction_method,result_versions,lift,interval_low,interval_high,significant,p_value,treatment_rate,control_rate,n_treatment,n_control,engine_version",
  );
  expect(lines).toHaveLength(3);
  // The formula is protected: the cell starts with a quote, so a spreadsheet shows it as text.
  expect(lines[1]).toContain(`"'=HYPERLINK(`);
  expect(lines[1]).not.toMatch(/(^|,)"?=HYPERLINK/);
  expect(lines[1]).toContain(`"'+cmd, with a comma"`);
  expect(text).not.toMatch(/@|[0-9a-f]{64}/);
});

test("the CSV export of the demo ledger lists the four synthetic entries with their results", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export as CSV" }).click(),
  ]);
  const lines = fs.readFileSync((await download.path())!, "utf8").split("\r\n");
  expect(lines).toHaveLength(6);
  expect(lines.slice(1, 5).every((l) => l.includes(",synthetic demo,"))).toBe(true);
  // The entry with a recorded result has numbers in the result columns.
  const header = lines[0].split(",");
  const withResult = lines.slice(1, 5).filter((l) => /,readable,/.test(l));
  expect(withResult.length).toBeGreaterThan(0);
  expect(withResult[0]).toMatch(/,0\.\d+,/);
  expect(header).toContain("interval_low");
});
