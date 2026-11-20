import { expect, test } from "@playwright/test";

test("the public build has no account link, and the account page says pilot accounts are off", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Account" })).toHaveCount(0);
  await page.goto("/account");
  await expect(page.getByText("Pilot accounts are not turned on in this version of the app.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: /Pilot accounts/ })).toHaveCount(0);
});
