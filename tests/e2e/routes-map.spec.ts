import { expect, test } from "@playwright/test";

test("status filter hides unrelated events", async ({ page }) => {
  await page.goto("/routes");

  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
  await page.getByLabel("Booking status").selectOption("pending_contract");

  await expect(
    page.getByRole("link", { name: "Pending Contract" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Declined" })).not.toBeVisible();
});

test("events without coordinates stay visible outside the map", async ({ page }) => {
  await page.goto("/routes");

  await expect(
    page.getByRole("heading", { name: "Events without map coordinates" }),
  ).toBeVisible();
});
