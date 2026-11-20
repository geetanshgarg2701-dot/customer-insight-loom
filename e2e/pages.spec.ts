import { expect, test } from "@playwright/test";

test("the privacy and terms pages exist, say what the app does, and are linked from every page", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page).toHaveTitle(/Privacy/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByText("Your files stay in your browser.").first()).toBeVisible();
  await expect(page.getByText(/does not use cookies, local storage/)).toBeVisible();
  // Honest about what it cannot do.
  await expect(page.getByText(/does not reliably remove personal names/)).toBeVisible();
  await expect(page.getByText(/What the website host can see/)).toBeVisible();

  await page.goto("/terms");
  await expect(page).toHaveTitle(/Terms/);
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
  await expect(page.getByText(/No warranty/)).toBeVisible();

  for (const path of ["/", "/ledger", "/intake", "/methods"]) {
    await page.goto(path);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", /\/privacy\/?$/);
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", /\/terms\/?$/);
  }
});

test("an unknown address gets a real 404 page in the same style, with a way home", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(250, 248, 244)");
});

test("the site has its own icon, not the starter template's", async ({ page, request, baseURL }) => {
  await page.goto("/");
  const href = await page.locator('link[rel~="icon"]').first().getAttribute("href");
  expect(href).toMatch(/icon\.svg/);
  const response = await request.get(new URL(href!, baseURL!).toString());
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/svg/);
  expect(await response.text()).toContain("#8a3b12");
});
