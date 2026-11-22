import type { Page } from "@playwright/test";

/** Which menu group each screen sits in. Home and Methods are plain links in the bar. */
const GROUP: Record<string, string> = {
  Ledger: "Experiments",
  "Email check": "Experiments",
  "Email drafts": "Experiments",
  Journeys: "Customers",
  Pipeline: "Customers",
  Comments: "Customers",
  "Data intake": "Your data",
  "Data check": "Your data",
  Webhooks: "Your data",
  "Your data": "Your data",
};

/** Goes to a screen through the top menu, opening its group first, or the whole menu on a phone. */
export async function navTo(page: Page, name: string): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Main" });
  const menu = nav.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) {
    if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
  } else if (GROUP[name]) {
    const group = nav.getByRole("button", { name: GROUP[name], exact: true });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  }
  await nav.getByRole("link", { name, exact: true }).click();
}
