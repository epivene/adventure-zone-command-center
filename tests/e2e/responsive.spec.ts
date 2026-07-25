import { expect, test, type Page } from "@playwright/test";

import { arrangeReleaseBookings } from "./fixtures/release-bookings";

const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
            document.documentElement.clientWidth &&
          document.body.scrollWidth <= document.body.clientWidth,
      ),
    )
    .toBe(true);
}

for (const viewport of viewports) {
  test(`${viewport.name} reaches every primary screen without horizontal scrolling`, async ({
    page,
  }) => {
    const fixture = await arrangeReleaseBookings();
    await page.setViewportSize(viewport);

    try {
      const primaryScreens = [
        { path: "/today", heading: "Today" },
        { path: "/bookings", heading: "Bookings" },
        { path: "/calendar", heading: "Calendar" },
        { path: "/routes", heading: "Routes" },
      ] as const;

      for (const screen of primaryScreens) {
        await page.goto(screen.path);
        await expect(
          page.getByRole("heading", { level: 1, name: screen.heading }),
        ).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }

      await page.getByRole("button", { name: "Quick Add" }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Add a lead" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto(`/bookings/${fixture.followUpBookingId}`);
      await page.getByRole("button", { name: "Complete call" }).click();
      await expect(page.getByRole("dialog", { name: "Complete call" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    } finally {
      await fixture.cleanup();
    }
  });
}
