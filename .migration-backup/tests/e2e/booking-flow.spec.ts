import { expect, test } from "@playwright/test";

function futureDate(daysFromToday: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date;
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function displayedDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

test("new lead remains visible after its first call", async ({ page }, testInfo) => {
  const eventName = `Example County Fair ${Date.now()}-${testInfo.workerIndex}`;
  const firstFollowUp = futureDate(7);
  const nextFollowUp = futureDate(8);

  await page.goto("/bookings");
  await page.getByRole("button", { name: "Quick Add" }).click();
  await page.getByLabel("Event name").fill(eventName);
  await page.getByLabel("City").fill("Example");
  await page.getByLabel("State").fill("ND");
  await page.getByLabel("Next action").selectOption("call");
  await page.getByLabel("Follow-up date").fill(dateInputValue(firstFollowUp));
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("link", { name: eventName })).toBeVisible();

  await page.getByRole("link", { name: eventName }).click();
  await expect(page.getByRole("heading", {
    name: "Packages and resources",
  })).toBeVisible();
  await page.getByRole("button", { name: "Complete call" }).click();
  await page.getByLabel("Call outcome").selectOption("call_again");
  await page.getByLabel("Next action type").selectOption("call");
  await page.getByLabel("Next action date").fill(dateInputValue(nextFollowUp));
  await page.getByRole("button", { name: "Save call outcome" }).click();

  await expect(page.getByRole("dialog")).not.toBeVisible();

  const followUps = page
    .getByRole("heading", { name: "Follow-ups" })
    .locator("..");
  const completedCall = followUps
    .getByRole("listitem")
    .filter({ hasText: "call again" });
  await expect(completedCall.getByText("Completed", { exact: true })).toBeVisible();

  const replacementCall = followUps
    .getByRole("listitem")
    .filter({ hasText: `Due ${displayedDate(nextFollowUp)}` });
  await expect(replacementCall.getByText("Open", { exact: true })).toBeVisible();

  await page.goto("/bookings");
  await expect(page.getByRole("link", { name: eventName })).toBeVisible();
});
