import { randomUUID } from "node:crypto";

import nextEnvironment from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const { loadEnvConfig } = nextEnvironment;

type CallFixture = {
  bookingId: string;
  bookingName: string;
  contactId: string;
  followUpId: string;
  organizationId: string;
  organizationName: string;
  cleanup: () => Promise<void>;
};

function dateInputValue(daysFromToday: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysFromToday);
  return value.toISOString().slice(0, 10);
}

async function arrangeCallFixture(): Promise<CallFixture> {
  loadEnvConfig(process.cwd());
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to arrange Call Workspace E2E fixtures.");
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const organizationId = randomUUID();
  const contactId = randomUUID();
  const bookingId = randomUUID();
  const followUpId = randomUUID();
  const runId = randomUUID();
  const bookingName = `E2E Call Workspace ${runId}`;
  const organizationName = `E2E Organization ${runId}`;

  try {
    await sql.begin(async (transaction) => {
      await transaction`
        insert into organizations (id, name)
        values (${organizationId}, ${organizationName})
      `;
      await transaction`
        insert into contacts (id, organization_id, first_name, last_name, phone)
        values (${contactId}, ${organizationId}, 'Morgan', 'Caller', '406-555-0199')
      `;
      await transaction`
        insert into bookings (
          id, organization_id, primary_contact_id, name, city, region, status, probability
        )
        values (
          ${bookingId}, ${organizationId}, ${contactId}, ${bookingName}, 'Fargo', 'ND', 'possible', 'possible'
        )
      `;
      await transaction`
        insert into follow_ups (id, organization_id, contact_id, booking_id, kind, due_at)
        values (${followUpId}, ${organizationId}, ${contactId}, ${bookingId}, 'call', ${new Date().toISOString()})
      `;
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }

  return {
    bookingId,
    bookingName,
    contactId,
    followUpId,
    organizationId,
    organizationName,
    cleanup: async () => {
      try {
        await sql`delete from call_sessions where organization_id = ${organizationId}`;
        await sql`delete from activities where organization_id = ${organizationId}`;
        await sql`delete from follow_ups where organization_id = ${organizationId}`;
        await sql`delete from bookings where organization_id = ${organizationId}`;
        await sql`delete from contacts where organization_id = ${organizationId}`;
        await sql`delete from organizations where id = ${organizationId}`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    },
  };
}

async function cleanupOrganizationByName(organizationName: string) {
  loadEnvConfig(process.cwd());
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      delete from call_sessions using organizations
      where call_sessions.organization_id = organizations.id and organizations.name = ${organizationName}
    `;
    await sql`
      delete from activities using organizations
      where activities.organization_id = organizations.id and organizations.name = ${organizationName}
    `;
    await sql`
      delete from follow_ups using organizations
      where follow_ups.organization_id = organizations.id and organizations.name = ${organizationName}
    `;
    await sql`
      delete from bookings using organizations
      where bookings.organization_id = organizations.id and organizations.name = ${organizationName}
    `;
    await sql`
      delete from contacts using organizations
      where contacts.organization_id = organizations.id and organizations.name = ${organizationName}
    `;
    await sql`delete from organizations where name = ${organizationName}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function completeCall(
  page: Page,
  input: { disposition: string; note: string; nextAction?: string; nextActionDate?: string; lastResortReason?: string },
) {
  await page.getByRole("button", { name: "Start call note" }).click();
  await page.getByLabel("Call note").fill(input.note);
  await page.getByLabel("Call disposition").selectOption(input.disposition);
  if (input.nextAction) {
    await page.getByLabel("Next action").selectOption(input.nextAction);
    await page.getByLabel("Next action date").fill(input.nextActionDate!);
  }
  if (input.lastResortReason) {
    await page.getByLabel("Last Resort reason").fill(input.lastResortReason);
  }
  await page.getByRole("button", { name: "Save call note" }).click();
}

test("Today opens a due call with its exact contact, booking, and follow-up context", async ({ page }) => {
  const fixture = await arrangeCallFixture();

  try {
    await page.goto("/today");
    const call = page.getByRole("link", { name: fixture.bookingName, exact: true }).first();
    await expect(call).toHaveAttribute(
      "href",
      `/calls/new?contactId=${fixture.contactId}&bookingId=${fixture.bookingId}&followUpId=${fixture.followUpId}`,
    );
    await call.click();
    await expect(page).toHaveURL(`/calls/new?contactId=${fixture.contactId}&bookingId=${fixture.bookingId}&followUpId=${fixture.followUpId}`);
    await expect(page.getByText("Morgan Caller")).toBeVisible();
    await expect(page.getByText(fixture.bookingName)).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("Interested creates the next action, refreshes Today, and adds the call to the timeline", async ({ page }) => {
  const fixture = await arrangeCallFixture();
  const note = "Interested in a Friday proposal.";
  const nextActionDate = dateInputValue(2);

  try {
    await page.goto("/today");
    const originalCall = page.getByRole("link", { name: fixture.bookingName, exact: true }).first();
    const originalHref = await originalCall.getAttribute("href");
    await expect(originalHref).toBe(
      `/calls/new?contactId=${fixture.contactId}&bookingId=${fixture.bookingId}&followUpId=${fixture.followUpId}`,
    );
    await originalCall.click();
    await completeCall(page, {
      disposition: "interested",
      note,
      nextAction: "call",
      nextActionDate,
    });
    await expect(page.getByRole("status")).toHaveText("Call note saved.");

    await page.goto("/today");
    const hrefs = await page.getByRole("link", { name: fixture.bookingName, exact: true })
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefs).not.toContain(originalHref);
    const replacementHref = hrefs.find((href): href is string => Boolean(href) && href !== originalHref);
    expect(replacementHref).toMatch(new RegExp(
      `^/calls/new\\?contactId=${fixture.contactId}&bookingId=${fixture.bookingId}&followUpId=(?!${fixture.followUpId}$)[0-9a-f-]+$`,
    ));
    const replacement = page.locator(`li a[href="${replacementHref}"]`);
    await expect(replacement).toHaveCount(1);
    await expect(replacement.locator("xpath=ancestor::li")).toContainText("call");
    await expect(replacement.locator("xpath=ancestor::li")).toContainText(
      `Due ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Chicago" }).format(new Date(`${nextActionDate}T18:00:00.000Z`))}`,
    );
    await replacement.click();
    await expect(page.getByText(note)).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("Declined closes the current follow-up", async ({ page }) => {
  const fixture = await arrangeCallFixture();

  try {
    await page.goto(`/calls/new?contactId=${fixture.contactId}&followUpId=${fixture.followUpId}`);
    await completeCall(page, { disposition: "declined", note: "They selected another vendor." });
    await expect(page.getByRole("status")).toHaveText("Call note saved.");

    await page.goto("/today");
    await expect(page.getByRole("link", { name: fixture.bookingName, exact: true })).toHaveCount(0);
  } finally {
    await fixture.cleanup();
  }
});

test("Last Resort requires a reason and displays it after completion", async ({ page }) => {
  const fixture = await arrangeCallFixture();

  try {
    await page.goto(`/calls/new?contactId=${fixture.contactId}&followUpId=${fixture.followUpId}`);
    await page.getByRole("button", { name: "Start call note" }).click();
    await page.getByLabel("Call disposition").selectOption("move_to_last_resort");
    await page.getByRole("button", { name: "Save call note" }).click();
    await expect(page.getByRole("alert")).toHaveText("Add a Last Resort reason");

    await page.getByLabel("Last Resort reason").fill("Repeated cancellations.");
    await page.getByRole("button", { name: "Save call note" }).click();
    await expect(page.getByRole("status")).toHaveText("Call note saved.");

    await page.reload();
    await expect(page.getByRole("alert")).toHaveText(
      `${fixture.organizationName} is marked Last Resort. Repeated cancellations.`,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("an unknown caller can be Quick Added and complete a call", async ({ page }) => {
  const runId = randomUUID();
  const organizationName = `E2E Quick Add ${runId}`;

  try {
    await page.goto("/quick-add");
    await page.getByLabel("Name").fill("Taylor New Caller");
    await page.getByLabel("Organization or event").fill(organizationName);
    await page.getByLabel("Phone").fill("406-555-0188");
    await page.getByLabel("Reason for calling").fill("Asked about next season.");
    await page.getByRole("button", { name: "Create caller" }).click();
    await expect(page.getByRole("heading", { name: "Call Workspace" })).toBeVisible();

    await completeCall(page, { disposition: "no_answer", note: "Left a callback request." });
    await expect(page.getByRole("status")).toHaveText("Call note saved.");
  } finally {
    await cleanupOrganizationByName(organizationName);
  }
});
