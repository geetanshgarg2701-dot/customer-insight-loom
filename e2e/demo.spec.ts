import fs from "node:fs";
import { expect, test } from "@playwright/test";

test("loads the synthetic demo and reads out the running entry from a demo results file", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const posts: string[] = [];
  context.on("request", (req) => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) foreign.push(req.url());
    if (req.method() !== "GET" && req.method() !== "HEAD") posts.push(req.method() + " " + req.url());
  });

  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 3 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });

  const list = page.getByRole("table", { name: "Ledger entries" });
  const rows = list.getByRole("row");
  await expect(rows).toHaveCount(4);
  for (const row of await rows.all().then((r) => r.slice(1))) {
    await expect(row).toContainText("Synthetic demo data");
  }
  await expect(rows.nth(1)).toContainText("readable");
  await expect(rows.nth(1)).toContainText("Confirmatory");
  await expect(rows.nth(2)).toContainText("Exploratory");
  await expect(rows.nth(3)).toContainText("running");

  // The demo audience a visitor can download is synthetic and reserved.
  const [audience] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download demo audience" }).click(),
  ]);
  const audienceText = fs.readFileSync((await audience.path())!, "utf8");
  expect(audienceText.split("\r\n").filter(Boolean)).toHaveLength(5001);
  expect(audienceText).toContain("@example.invalid");

  // Open the running entry and read it out from its demo results file.
  await page.getByRole("link", { name: /still running/ }).click();
  await expect(page.getByText("Status: running")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/generated with a true lift of 4\.00 points/)).toBeVisible();

  const results = page.getByRole("region", { name: "Results" });
  const [demoFile] = await Promise.all([
    page.waitForEvent("download"),
    results.getByRole("button", { name: "Download demo results file" }).click(),
  ]);
  const demoPath = (await demoFile.path())!;
  expect(fs.readFileSync(demoPath, "utf8").split("\r\n")[0]).toBe("email,group,converted");

  await results.getByLabel("Results CSV").setInputFiles(demoPath);
  await expect(results.getByLabel("Converted column")).toHaveValue("2", { timeout: 30_000 });
  await results.getByRole("button", { name: "Verify and read out" }).click();
  await expect(results.getByText("Readout: readable")).toBeVisible({ timeout: 60_000 });

  const verification = results.getByRole("table", { name: "Verification" });
  await expect(verification.getByRole("row", { name: /People never assigned/ })).toContainText("0");
  await expect(verification.getByRole("row", { name: /Wrong group/ })).toContainText("0");
  await expect(verification.getByRole("row", { name: /Assigned but missing/ })).toContainText("0");
  // About 2 percent of windows were left open, and the readout says it excluded them.
  await expect(results.getByText(/conversion window is still open are excluded/)).toBeVisible();

  // No synthetic address is ever shown on the page.
  expect(await page.locator("body").innerText()).not.toContain("example.invalid");

  await results.getByRole("button", { name: "Record result in ledger" }).click();
  await expect(page.getByText("Status: readable")).toBeVisible();

  expect(foreign).toEqual([]);
  expect(posts).toEqual([]);
});

test("refuses to load the demo into a ledger that has entries", async ({ page }) => {
  await page.goto("/ledger");
  await page.getByLabel("Title", { exact: true }).fill("Mine");
  await page.getByLabel("Hypothesis").fill("H");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("table", { name: "Ledger entries" })).toContainText("Mine", { timeout: 30_000 });
  // The button is offered only while the ledger is empty.
  await expect(page.getByRole("button", { name: "Load demo data" })).toHaveCount(0);
});
