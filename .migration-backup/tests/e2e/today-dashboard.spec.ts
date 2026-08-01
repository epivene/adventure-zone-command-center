import { expect, test } from "@playwright/test";

test("today keeps overdue follow-ups front and center", async ({ page }) => {
  await page.goto("/today");

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("Overdue follow-ups")).toBeVisible();
  await expect(page.getByText("Needs Follow-up Plan")).toBeVisible();
});
