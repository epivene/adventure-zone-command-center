import { expect, test } from "@playwright/test";

test("new lead remains visible after its first call", async ({ page }) => {
  await page.goto("/bookings");
  await page.getByRole("button", { name: "Quick Add" }).click();
  await page.getByLabel("Event name").fill("Example County Fair");
  await page.getByLabel("City").fill("Example");
  await page.getByLabel("State").fill("ND");
  await page.getByLabel("Next action").selectOption("call");
  await page.getByLabel("Follow-up date").fill("2026-08-03");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Example County Fair")).toBeVisible();

  await page.getByRole("link", { name: "Example County Fair" }).click();
  await page.getByRole("button", { name: "Complete call" }).click();
  await page.getByLabel("Call outcome").selectOption("call_again");
  await page.getByLabel("Next action type").selectOption("call");
  await page.getByLabel("Next action date").fill("2026-08-04");
  await page.getByRole("button", { name: "Save call outcome" }).click();

  await expect(
    page.getByRole("heading", { name: "Example County Fair" }),
  ).toBeVisible();
});
