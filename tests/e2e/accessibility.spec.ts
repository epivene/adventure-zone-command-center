import { expect, test } from "@playwright/test";

import { arrangeReleaseBookings } from "./fixtures/release-bookings";

test("booking fields and statuses expose text-based accessible names", async ({
  page,
}) => {
  const fixture = await arrangeReleaseBookings();

  try {
    await page.goto("/bookings/new");
    for (const label of [
      "Event name",
      "City",
      "State",
      "Status",
      "Probability",
      "Next action",
      "Follow-up date",
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }

    await page.goto("/bookings");
    for (const label of [
      "Booking status",
      "Probability",
      "State",
      "Travel leg",
      "Starts after",
      "Starts before",
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    const booking = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: fixture.possibleBookingName }) });
    await expect(
      booking.locator("span").filter({ hasText: /^Possible$/ }),
    ).toBeVisible();

    await page.goto("/settings/import");
    await expect(page.getByLabel("Act! CSV file", { exact: true })).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("map statuses can be filtered without operating the map canvas", async ({
  page,
}) => {
  const fixture = await arrangeReleaseBookings();

  try {
    await page.goto("/routes");

    for (const label of [
      "Booking status",
      "Travel leg",
      "State",
      "Starts after",
      "Starts before",
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await page.getByLabel("Booking status").selectOption("possible");
    await expect(
      page.getByRole("link", { name: fixture.possibleBookingName }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: fixture.pendingBookingName }),
    ).not.toBeVisible();

    await page.getByLabel("Booking status").selectOption("pending_contract");
    await expect(
      page.getByRole("link", { name: fixture.pendingBookingName }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: fixture.possibleBookingName }),
    ).not.toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("follow-up dialog traps focus and returns it to the trigger", async ({
  page,
}) => {
  const fixture = await arrangeReleaseBookings();

  try {
    await page.goto(`/bookings/${fixture.followUpBookingId}`);
    const trigger = page.getByRole("button", { name: "Complete call" });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Complete call" });
    const firstControl = dialog.getByLabel("Call outcome");
    const lastControl = dialog.getByRole("button", { name: "Save call outcome" });

    for (const label of [
      "Call outcome",
      "Resulting status",
      "Next action type",
      "Next action date",
    ]) {
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(firstControl).toBeFocused();
    await firstControl.press("Shift+Tab");
    await expect(lastControl).toBeFocused();
    await lastControl.press("Tab");
    await expect(firstControl).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  } finally {
    await fixture.cleanup();
  }
});

test("Call Workspace is keyboard-completable with labeled controls and visible focus", async ({ page }) => {
  const fixture = await arrangeReleaseBookings();

  try {
    await page.goto(`/calls/new?bookingId=${fixture.followUpBookingId}`);
    const start = page.getByRole("button", { name: "Start call note" });
    await start.focus();
    await expect(start).toBeFocused();
    await expect(start).toHaveCSS("outline-style", "solid");
    await start.press("Enter");

    for (const label of [
      "Call note",
      "Call disposition",
      "Next action",
      "Next action date",
    ]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await page.getByLabel("Call note").fill("Keyboard entry.");
    await page.getByLabel("Call disposition").selectOption("no_answer");
    const save = page.getByRole("button", { name: "Save call note" });
    await save.focus();
    await expect(save).toBeFocused();
    await expect(save).toHaveCSS("outline-style", "solid");
  } finally {
    await fixture.cleanup();
  }
});

test("mobile navigation items have distinct accessible names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");

  const navigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await expect(navigation.getByRole("link", { name: "Today", exact: true })).toHaveCount(1);
  await expect(
    navigation.getByRole("link", { name: "Bookings", exact: true }),
  ).toHaveCount(1);
  await expect(
    navigation.getByRole("link", { name: "Calendar", exact: true }),
  ).toHaveCount(1);
  await expect(
    navigation.getByRole("link", { name: "Routes", exact: true }),
  ).toHaveCount(1);
  const settingsControl = navigation.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  await expect(settingsControl).toHaveCount(1);
  await expect(settingsControl).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Quick Add", exact: true }),
  ).toHaveCount(1);
});
