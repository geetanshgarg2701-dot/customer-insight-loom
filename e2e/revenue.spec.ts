import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Opens the running demo entry, whose results file the demo can make. */
async function openRunning(page: Page) {
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: /still running/ }).click();
  await expect(page.getByText("Status: running")).toBeVisible({ timeout: 30_000 });
  return page.getByRole("region", { name: "Results" });
}

/** The demo results file with a revenue column: 40 dollars for a treatment buyer, 50 for a control buyer, as in the plan's case. */
function withRevenue(demoPath: string, leaveBlank = 0) {
  const lines = fs.readFileSync(demoPath, "utf8").split("\r\n").filter(Boolean);
  const [header, ...rows] = lines;
  let blanked = 0;
  const out = rows.map((line) => {
    const [email, group, converted] = line.split(",");
    let revenue = converted === "1" ? (group === "treatment" ? "40" : "50") : "";
    if (converted === "1" && blanked < leaveBlank) {
      revenue = "";
      blanked++;
    }
    return `${email},${group},${converted},${revenue}`;
  });
  const file = path.join(os.tmpdir(), `revenue-${Date.now()}-${leaveBlank}.csv`);
  fs.writeFileSync(file, [`${header},revenue`, ...out].join("\r\n") + "\r\n");
  // What the screen should say, counted from the file: people whose window is closed, and revenue per recipient.
  const tally = { treatment: { n: 0, buyers: 0, sum: 0 }, control: { n: 0, buyers: 0, sum: 0 } };
  for (const line of rows) {
    const [, group, converted] = line.split(",");
    if (converted === "") continue;
    const t = tally[group as "treatment" | "control"];
    t.n++;
    if (converted === "1") {
      t.buyers++;
      t.sum += group === "treatment" ? 40 : 50;
    }
  }
  return { file, tally };
}

const money = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test("a revenue column gives revenue per recipient that matches the file, and the stored result keeps it", async ({ page }) => {
  test.setTimeout(240_000);
  const results = await openRunning(page);
  const [demoFile] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: "Download demo results file" }).click()]);
  const { file, tally } = withRevenue((await demoFile.path())!);

  await results.getByLabel("Results CSV").setInputFiles(file);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  // Revenue is never picked for the person.
  await expect(results.getByLabel("Revenue column, optional")).toHaveValue("-1");
  await results.getByLabel("Revenue column, optional").selectOption({ label: "revenue" });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });

  const panel = results.getByRole("region", { name: "Revenue per recipient" });
  const table = panel.getByRole("table", { name: "Revenue per recipient" });
  const treatmentMean = tally.treatment.sum / tally.treatment.n;
  const controlMean = tally.control.sum / tally.control.n;
  await expect(table.getByRole("row", { name: /^Treatment, per recipient/ })).toContainText(money(treatmentMean));
  await expect(table.getByRole("row", { name: /^Treatment, per recipient/ })).toContainText(`${tally.treatment.n.toLocaleString("en-US")} people`);
  await expect(table.getByRole("row", { name: /^Control, per recipient/ })).toContainText(money(controlMean));
  const diff = treatmentMean - controlMean;
  await expect(table.getByRole("row", { name: /^Difference, per recipient/ })).toContainText(`${diff < 0 ? "-" : "+"}$${Math.abs(diff).toFixed(2)}`);
  await expect(table.getByRole("row", { name: /percent interval/ })).toBeVisible();
  await expect(panel.getByText(/It is not a forecast/)).toBeVisible();

  // Record it. The version table shows the revenue difference.
  await results.getByRole("button", { name: "Record result in ledger" }).click();
  await expect(page.getByText("Status: readable")).toBeVisible();
  const versions = results.getByRole("table", { name: "Result versions" });
  await expect(versions).toContainText("Revenue per recipient");
  await expect(versions.getByRole("row").nth(1)).toContainText(`${diff < 0 ? "-" : "+"}$${Math.abs(diff).toFixed(2)}`);
});

test("revenue is not shown when someone who converted has no value, and the lift still is", async ({ page }) => {
  test.setTimeout(240_000);
  const results = await openRunning(page);
  const [demoFile] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: "Download demo results file" }).click()]);
  const { file } = withRevenue((await demoFile.path())!, 4);
  await results.getByLabel("Results CSV").setInputFiles(file);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  await results.getByLabel("Revenue column, optional").selectOption({ label: "revenue" });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });
  await expect(results.getByRole("table", { name: "Readout" })).toBeVisible();
  const panel = results.getByRole("region", { name: "Revenue per recipient" });
  await expect(panel).toContainText("Revenue is not shown. 4 people who converted have no revenue value");
  await expect(panel.getByRole("table")).toHaveCount(0);
});

test("with no revenue column there is no revenue panel, and the revenue controls pass axe and fit a phone", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const results = await openRunning(page);
  const [demoFile] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: "Download demo results file" }).click()]);
  const { file } = withRevenue((await demoFile.path())!);
  await results.getByLabel("Results CSV").setInputFiles(file);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });
  await expect(results.getByRole("region", { name: "Revenue per recipient" })).toHaveCount(0);

  // A readout releases the file, as it always did, so the same file is chosen again to map the revenue column.
  await results.getByLabel("Results CSV").setInputFiles(file);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  await results.getByLabel("Revenue column, optional").selectOption({ label: "revenue" });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByRole("region", { name: "Revenue per recipient" })).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
