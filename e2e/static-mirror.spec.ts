import fs from "node:fs";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { navTo } from "./nav-helper";

const PREFIX = process.env.MIRROR_PREFIX ?? "evidence-ledger";

// Runs only through playwright.static.config.ts, against the static export under /evidence-ledger, or under MIRROR_PREFIX.
test("the static mirror loads DuckDB from its own prefix and runs the demo with no other host", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const missing: string[] = [];
  context.on("request", (req) => {
    if (/^https?:/.test(req.url()) && new URL(req.url()).origin !== origin) foreign.push(req.url());
  });
  context.on("response", (res) => {
    // Next asks a rewriting host for flattened prefetch files such as __next.ledger.__PAGE__.txt. A plain static host
    // such as GitHub Pages cannot rewrite, so those 404. The page still works, and the click below proves it.
    const prefetch = /\/__next\.[^/]*\.txt$/.test(new URL(res.url()).pathname);
    if (res.status() >= 400 && !prefetch) missing.push(`${res.status()} ${res.url()}`);
  });

  await page.goto("ledger/");
  await expect(page.getByRole("link", { name: "Methods" })).toHaveAttribute("href", `/${PREFIX}/methods/`);
  await page.getByRole("button", { name: "Load demo data" }).click();
  await expect(page.getByText("Loaded 4 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("table", { name: "Ledger entries" }).getByRole("row")).toHaveCount(5);

  // A decision deck is built in the page on the static site too, and asks for nothing outside it.
  await page.getByRole("link", { name: "Synthetic: win back email with a 10 percent offer" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const [deck] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export the decision deck" }).click(),
  ]);
  expect(deck.suggestedFilename()).toMatch(/^decision-deck-.*\.pptx$/);
  const zip = await JSZip.loadAsync(fs.readFileSync((await deck.path())!));
  expect(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(5);
  await navTo(page, "Ledger");

  // The theme coding model loads from the site's own prefix and asks for nothing outside it.
  await navTo(page, "Comments");
  await page.getByRole("button", { name: "Load synthetic comments" }).click();
  const coding = page.getByRole("region", { name: "Theme coding by the in-browser model" });
  await coding.getByRole("button", { name: /^Load the model, about \d+ MB$/ }).click();
  await expect(coding.getByText("The model is loaded in this tab.")).toBeVisible({ timeout: 120_000 });
  await navTo(page, "Ledger");

  // Moving between pages by clicking works without the prefetch files.
  await page.getByRole("link", { name: "Methods" }).click();
  await expect(page).toHaveURL(new RegExp(`/${PREFIX}/methods/$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Data intake" }).click();
  await expect(page).toHaveURL(new RegExp(`/${PREFIX}/intake/$`));
  await expect(page.getByLabel("CSV file")).toBeVisible();

  expect(missing).toEqual([]);
  expect(foreign).toEqual([]);
});
