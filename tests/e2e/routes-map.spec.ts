import { expect, test } from "@playwright/test";
import { arrangeRouteMapBookings } from "./fixtures/route-map-bookings";

test("status filter hides unrelated events", async ({ page }) => {
  const fixture = await arrangeRouteMapBookings();

  try {
    await page.goto("/routes");

    await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: fixture.pendingName }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: fixture.declinedName }),
    ).toBeVisible();

    await page.getByLabel("Booking status").selectOption("pending_contract");

    await expect(
      page.getByRole("link", { name: fixture.pendingName }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: fixture.declinedName }),
    ).not.toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("events without coordinates stay visible outside the map", async ({ page }) => {
  await page.goto("/routes");

  await expect(
    page.getByRole("heading", { name: "Events without map coordinates" }),
  ).toBeVisible();
});
