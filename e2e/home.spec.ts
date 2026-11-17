import { expect, test } from "@playwright/test";

test("home page says what the app is and links to the working screens", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Evidence ledger");
  await expect(page.getByRole("heading", { level: 1, name: "Evidence ledger" })).toBeVisible();
  for (const name of ["Ledger", "Data intake", "Journeys", "Pipeline", "Methods"]) {
    await expect(page.locator("section").getByRole("link", { name, exact: true })).toBeVisible();
  }
  // The create-next-app placeholder is gone.
  await expect(page.getByText(/Deploy Now|edit the/)).toHaveCount(0);
  await expect(page.getByText("early version")).toBeVisible();
});
