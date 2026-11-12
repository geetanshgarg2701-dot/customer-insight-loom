import { expect, test } from "@playwright/test";

test("DuckDB-Wasm runs a query in the browser", async ({ page }) => {
  await page.goto("/duckdb-check");
  await expect(page.getByTestId("result")).toHaveText(
    JSON.stringify([{ answer: 42, greeting: "hello" }]),
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("error")).toHaveCount(0);
});

test("DuckDB files are self-hosted, with no third-party requests", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const urls: string[] = [];
  context.on("request", (req) => {
    if (/^https?:/.test(req.url())) urls.push(req.url());
  });

  await page.goto("/duckdb-check");
  await expect(page.getByTestId("result")).toBeVisible({ timeout: 30_000 });

  expect(urls.some((u) => /\/duckdb\/duckdb-.*\.worker\.js$/.test(u))).toBe(true);
  const foreign = urls.filter((u) => new URL(u).origin !== origin);
  expect(foreign).toEqual([]);
});
