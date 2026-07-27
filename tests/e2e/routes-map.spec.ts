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

test("a booking edit populates Calendar and Map, can be cleared to unmapped, and keeps four configurable legs", async ({
  page,
}) => {
  const fixture = await arrangeRouteMapBookings();

  try {
    await page.goto("/routes");
    await expect(
      page.getByRole("group", { name: /Travel leg \d/ }),
    ).toHaveCount(4);
    await expect(
      page.getByRole("group", { name: "Travel leg 5" }),
    ).toHaveCount(0);
    const configuredName = `North E2E ${fixture.pendingBookingId.slice(0, 8)}`;
    await page.getByLabel("Travel leg 1 name").fill(configuredName);
    await page.getByRole("button", { name: "Save travel legs" }).click();
    await expect(page.getByRole("status")).toHaveText("Travel legs saved.");
    await expect(
      page.getByRole("group", { name: /Travel leg \d/ }),
    ).toHaveCount(4);

    await page.goto(`/bookings/${fixture.pendingBookingId}/edit`);
    await page.getByLabel("Venue").fill("E2E River Grounds");
    await page.getByLabel("Street address").fill("10 Main St");
    await page.getByLabel("Start date").fill("2026-08-10");
    await page.getByLabel("End date").fill("2026-08-12");
    await page.getByLabel("Latitude").fill("46.8772");
    await page.getByLabel("Longitude").fill("-96.7898");
    await page.getByLabel("Travel leg").selectOption({ index: 1 });
    await page.getByLabel("Notes").fill("Map and calendar E2E");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(`/bookings/${fixture.pendingBookingId}`);

    await page.goto("/routes");
    await expect(
      page
        .getByRole("heading", { name: "Mapped events" })
        .locator("..")
        .getByRole("link", { name: fixture.pendingName }),
    ).toBeVisible();

    await page.goto("/calendar");
    await page.getByRole("button", { name: "Agenda view" }).click();
    await expect(
      page.getByRole("link", { name: new RegExp(fixture.pendingName) }),
    ).toBeVisible();

    await page.goto(`/bookings/${fixture.pendingBookingId}/edit`);
    await page.getByLabel("Latitude").fill("");
    await page.getByLabel("Longitude").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(`/bookings/${fixture.pendingBookingId}`);

    await page.goto("/routes");
    await expect(
      page
        .getByRole("heading", { name: "Events without map coordinates" })
        .locator("..")
        .getByRole("link", { name: fixture.pendingName }),
    ).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});
