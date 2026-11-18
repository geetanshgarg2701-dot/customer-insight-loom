import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("Loaded 3 synthetic demo entries.")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("table", { name: "Ledger entries" }).getByRole("row")).toHaveCount(4);

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
