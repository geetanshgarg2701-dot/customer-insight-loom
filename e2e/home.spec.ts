import { expect, test } from "@playwright/test";

test("home page says what the app is and links to the working screens", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Customer Insight Loom");
  await expect(page.getByRole("heading", { level: 1, name: "Customer Insight Loom" })).toBeVisible();
  // Each working screen is linked from its group card, grouped as in the sidebar.
  const groups = page.getByRole("main").locator(".home-groups");
  for (const [group, name] of [["Experiments", "Ledger"], ["Experiments", "Email check"], ["Customers", "Journeys"], ["Customers", "Pipeline"], ["Your data", "Data intake"], ["Your data", "Data check"]]) {
    await expect(groups.getByRole("region", { name: group }).getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("main").getByRole("link", { name: "Methods", exact: true })).toBeVisible();
  // The create-next-app placeholder is gone.
  await expect(page.getByText(/Deploy Now|edit the/)).toHaveCount(0);
  await expect(page.getByRole("main").getByText("early version")).toBeVisible();
});
