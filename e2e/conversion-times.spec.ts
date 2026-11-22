import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Opens the running demo entry and returns the results region and the launch instant the page shows. */
async function openRunning(page: Page) {
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: /still running/ }).click();
  await expect(page.getByText("Status: running")).toBeVisible({ timeout: 30_000 });
  const text = (await page.getByText(/^Launched at /).first().textContent()) ?? "";
  const launched = /Launched at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(text)?.[1];
  if (!launched) throw new Error(`No launch time on the page: ${text}`);
  return { results: page.getByRole("region", { name: "Results" }), launched };
}

const HOUR = 3_600_000;

/**
 * The demo results file with a converted at column. The first `after` converters converted after the 168 hour window closed,
 * the next `before` before launch, and everyone else one day after launch. Times carry a Z, so the zone setting is not needed.
 */
function withTimes(demoPath: string, launched: string, after: number, before: number) {
  const launch = Date.parse(launched);
  const [header, ...rows] = fs.readFileSync(demoPath, "utf8").split("\r\n").filter(Boolean);
  let seen = 0;
  const out = rows.map((line) => {
    const [email, group, converted] = line.split(",");
    let when = "";
    if (converted === "1") {
      const k = seen++;
      when = new Date(launch + (k < after ? 169 * HOUR : k < after + before ? -1 * HOUR : 24 * HOUR)).toISOString();
    }
    return `${email},${group},${converted},${when}`;
  });
  const file = path.join(os.tmpdir(), `times-${Date.now()}-${after}-${before}.csv`);
  fs.writeFileSync(file, [`${header},converted_at`, ...out].join("\r\n") + "\r\n");
  return file;
}

async function demoFile(page: Page, results: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([page.waitForEvent("download"), results.getByRole("button", { name: "Download demo results file" }).click()]);
  return (await download.path())!;
}

test("a converted at column leaves out and recounts people by the time rules, and says how many", async ({ page }) => {
  test.setTimeout(240_000);
  const { results, launched } = await openRunning(page);
  const file = withTimes(await demoFile(page, results), launched, 10, 5);

  await results.getByLabel("Results CSV").setInputFiles(file);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  // The time column is never picked for the person, and the zone choice appears only once it is.
  await expect(results.getByLabel("Converted at column, optional")).toHaveValue("-1");
  await expect(results.getByLabel("Time zone for times with no zone")).toHaveCount(0);
  await results.getByLabel("Converted at column, optional").selectOption({ label: "converted_at" });
  await expect(results.getByLabel("Time zone for times with no zone")).toBeVisible();
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });

  await expect(results.getByText("10 people converted after the window closed, so they count as not converted in the window.")).toBeVisible();
  await expect(results.getByText("5 people converted before launch, so they were left out.")).toBeVisible();
  await expect(results.getByText(/Conversion times were read in the .+ zone/)).toBeVisible();
});

test("with no converted at column nothing is said about times", async ({ page }) => {
  test.setTimeout(240_000);
  const { results, launched } = await openRunning(page);
  const file = withTimes(await demoFile(page, results), launched, 10, 5);
  await results.getByLabel("Results CSV").setInputFiles(file);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });
  await expect(results.getByText(/Conversion times were read in/)).toHaveCount(0);
  await expect(results.getByText(/converted after the window closed/)).toHaveCount(0);
});

test("the time controls fit a phone and pass axe", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 375, height: 812 });
  const { results, launched } = await openRunning(page);
  const file = withTimes(await demoFile(page, results), launched, 3, 2);
  await results.getByLabel("Results CSV").setInputFiles(file);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  await results.getByLabel("Converted at column, optional").selectOption({ label: "converted_at" });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("3 people converted after the window closed, so they count as not converted in the window.")).toBeVisible({ timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});
