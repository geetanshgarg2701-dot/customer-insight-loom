import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { formatCount, formatPercent, formatSignedPoints } from "../src/lib/app/format";

async function slidesOf(path: string) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path));
  const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  names.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const xml = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  const charts = Object.keys(zip.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
  const chartXml = await Promise.all(charts.map((n) => zip.file(n)!.async("string")));
  return { xml, chartXml };
}

test("the entry page makes a deck whose numbers match the ledger's own export of that entry", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });

  // The ledger's CSV holds the stored numbers of every entry, which the deck must repeat.
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export as CSV" }).click()]);
  const lines = fs.readFileSync((await csv.path())!, "utf8").split("\r\n").filter(Boolean);
  const header = lines[0].split(",");
  const row = lines[1].split(",");
  const col = (name: string) => row[header.indexOf(name)];
  expect(col("status")).toBe("readable");
  const treatment = Number(col("treatment_rate"));
  const control = Number(col("control_rate"));
  const lift = Number(col("lift"));

  await page.getByRole("link", { name: "Synthetic: win back email with a 10 percent offer" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const section = page.getByRole("region", { name: "Decision deck" });
  const [download] = await Promise.all([page.waitForEvent("download"), section.getByRole("button", { name: "Export the decision deck" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^decision-deck-synthetic-win-back-email-with-a-10-percent-offer-\d{4}-\d{2}-\d{2}\.pptx$/);
  await expect(section.getByRole("status")).toContainText("It was built in this browser and nothing was uploaded.");

  const { xml, chartXml } = await slidesOf((await download.path())!);
  expect(xml).toHaveLength(5);
  expect(xml[0]).toContain("Synthetic: win back email with a 10 percent offer");

  // The deck uses the app's current look: a font PowerPoint has on Windows and Mac, and the app's red and ink.
  const everything = xml.join("") + chartXml.join("");
  expect(everything).toContain('typeface="Calibri"');
  expect(everything).not.toContain("Georgia");
  expect(everything).toContain("A8243B");
  expect(everything).toContain("18203A");
  expect(everything).not.toContain("8A3B12");
  expect(everything).not.toContain("FAF8F4");
  const result = xml[3];
  expect(result).toContain(formatPercent(treatment));
  expect(result).toContain(formatPercent(control));
  expect(result).toContain(formatSignedPoints(lift));
  expect(result).toContain(formatCount(Number(col("n_treatment"))));
  expect(result).toContain("Significant: yes");
  expect(chartXml).toHaveLength(1);
  expect(chartXml[0]).toContain(`<c:v>${Number((treatment * 100).toFixed(6))}</c:v>`);
  expect(xml[1]).toContain("Confirmatory");
  expect(xml[4]).toContain("synthetic");

  const axe = await new AxeBuilder({ page }).include("section[aria-labelledby='deck-h']").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("the evidence chain makes a deck with the chain slide and the linked test, and the button waits for a linked test", async ({ page }) => {
  test.setTimeout(240_000);
  // With no ledger entry naming the theme, there is no test to put in a deck.
  await page.goto("/insights");
  await page.getByRole("button", { name: "Load synthetic comments" }).click();
  await expect(page.getByRole("list", { name: "Evidence chain for Shipping costs too much" })).toBeVisible({ timeout: 120_000 });
  const button = page.getByRole("button", { name: "Export the decision deck for this chain" });
  await expect(button).toBeDisabled();
  await expect(page.getByText("Needs a ledger entry that names this theme")).toBeVisible();

  // The July demo entry names the shipping cost theme.
  await page.goto("/ledger");
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Comments" }).click();
  await page.getByRole("button", { name: "Load synthetic comments" }).click();
  await expect(page.getByRole("list", { name: "Evidence chain for Shipping costs too much" })).toBeVisible({ timeout: 120_000 });
  const enabled = page.getByRole("button", { name: "Export the decision deck for this chain" });
  await expect(enabled).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), enabled.click()]);
  expect(download.suggestedFilename()).toMatch(/^decision-deck-synthetic-free-shipping-banner-at-the-cart-launched-in-july-\d{4}-\d{2}-\d{2}\.pptx$/);

  const { xml } = await slidesOf((await download.path())!);
  expect(xml).toHaveLength(6);
  expect(xml[2]).toContain("Evidence chain: Shipping costs too much");
  expect(xml[2]).toContain("Association, not cause");
  expect(xml[2]).toContain("Synthetic: free shipping banner at the cart, launched in July");
  expect(xml[5]).toContain("association, not a cause");
});
