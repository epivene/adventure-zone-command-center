import { expect, test } from "@playwright/test";

import { arrangeBookingPackagesResources } from "./fixtures/booking-packages-resources";

test("edits package totals, requests, attribution, warnings, and overrides accessibly", async ({
  page,
}) => {
  const fixture = await arrangeBookingPackagesResources();
  try {
    await page.goto(`/bookings/${fixture.bookingId}/edit`);
    await expect(page.getByRole("heading", {
      name: "2 packages · 11 attractions",
    })).toBeVisible();
    await expect(page.getByText(
      "Inferred: Adventure Zone, Weekend Warriors",
    )).toBeVisible();
    await expect(page.getByLabel(/Paintball.*unavailable/i)).toBeChecked();

    const paintballAttribution = page.getByRole("group", {
      name: "Paintball attribution",
    });
    await paintballAttribution
      .getByLabel("Choose packages manually")
      .check();
    await expect(
      paintballAttribution.getByLabel("Adventure Zone"),
    ).toBeChecked();
    await paintballAttribution.getByLabel("Weekend Warriors").uncheck();

    await page.getByLabel("Physical attraction total").fill("13");
    await page.getByLabel("Out-of-range approval reason")
      .fill("Owner approved customer expansion");
    await page.getByRole("button", { name: "Save package setup" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Package setup saved.",
    );
    await expect(page.getByRole("heading", {
      name: "2 packages · 13 attractions",
    })).toBeVisible();

    await page.getByRole("link", { name: "Back to booking" }).click();
    const sharedAttractions = page
      .getByText("Shared physical attractions")
      .locator("..");
    await expect(sharedAttractions.getByText("13")).toBeVisible();
    await page.getByRole("link", { name: "Edit booking" }).click();
    await expect(page.getByRole("heading", {
      name: "2 packages · 13 attractions",
    })).toBeVisible();
    const reloadedPaintballAttribution = page.getByRole("group", {
      name: "Paintball attribution",
    });
    await expect(reloadedPaintballAttribution.getByText(
      "Manual: Adventure Zone",
    )).toBeVisible();
    await expect(
      reloadedPaintballAttribution.getByLabel("Choose packages manually"),
    ).toBeChecked();
    await expect(
      reloadedPaintballAttribution.getByLabel("Adventure Zone"),
    ).toBeChecked();
    await expect(
      reloadedPaintballAttribution.getByLabel("Weekend Warriors"),
    ).not.toBeChecked();

    await page.getByLabel("Request description").fill("Ferris wheel");
    await page.getByLabel("Count treatment").selectOption("add_to_count");
    await page.getByRole("button", { name: "Add special request" }).click();
    await expect(page.getByText(/Add to count.*Needs approval/i)).toBeVisible();
    await page.getByLabel("Decision reason for Ferris wheel")
      .fill("Owner approved");
    await page.getByRole("button", { name: "Approve Ferris wheel" }).click();
    await expect(page.getByText(/Add to count.*Approved/i)).toBeVisible();
    await expect(page.getByRole("heading", {
      name: "2 packages · 13 attractions",
    })).toBeVisible();

    const unavailableReason = page.getByLabel(
      "Override reason for Paintball is unavailable.",
    );
    await unavailableReason.focus();
    await expect(unavailableReason).toBeFocused();
    await unavailableReason.fill("Backup equipment confirmed");
    await page.getByRole("button", {
      name: "Override Paintball is unavailable.",
    }).click();
    await expect(page.getByText(/Overridden.*Backup equipment confirmed/i))
      .toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Special requests" }))
      .toBeVisible();
    await expect(page.getByRole("heading", { name: "Resource warnings" }))
      .toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});
