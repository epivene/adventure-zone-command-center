import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CallerFinderService } from "@/features/caller-finder/caller-finder-service";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";

const databaseContext = vi.hoisted(() => ({ database: undefined as unknown }));

vi.mock("@workspace/db", () => ({
  get db() {
    return databaseContext.database;
  },
}));
vi.mock("@/features/calls/call-repository", () => ({ DrizzleCallRepository: class {} }));
vi.mock("@/features/calls/call-service", () => ({ CallService: class {} }));
vi.mock("@/features/calls/call-workspace-context", () => ({
  DrizzleCallWorkspaceContextRepository: class {},
  activityTimelineParent: vi.fn(),
}));
vi.mock("@/features/activities/activity-service", () => ({ ActivityService: class {} }));
vi.mock("@/features/activities/activity-repository", () => ({ DrizzleActivityRepository: class {} }));
vi.mock("@/features/calls/call-workspace-query", () => ({ loadCallWorkspace: vi.fn() }));
vi.mock("@/features/bookings/booking-operations-summary", () => ({
  createBookingOperationsSummaryProvider: vi.fn(),
}));
vi.mock("@/features/contact-phones/contact-phone-repository", () => ({
  createContactPhoneRepository: vi.fn(),
}));

const targetContactId = "f0000000-0000-4000-8000-000000000001";
const originalAssistedCallingEnabled = process.env.ASSISTED_CALLING_ENABLED;
let client: PGlite;
let database: ReturnType<typeof drizzle>;

async function seedZipOnlyCallerFixture() {
  await client.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE contacts (
      id uuid PRIMARY KEY,
      organization_id uuid,
      first_name text NOT NULL,
      last_name text NOT NULL,
      email text,
      normalized_phone text,
      city text,
      region text,
      postal_code text
    );
    CREATE TABLE contact_phones (contact_id uuid NOT NULL, normalized_number text);
    CREATE TABLE bookings (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      city text NOT NULL,
      region text NOT NULL,
      postal_code text,
      status text NOT NULL,
      starts_at timestamptz,
      travel_leg_id uuid
    );
    CREATE TABLE booking_contacts (booking_id uuid NOT NULL, contact_id uuid NOT NULL);
    CREATE TABLE travel_legs (id uuid PRIMARY KEY, name text NOT NULL);
    CREATE TABLE follow_ups (
      contact_id uuid,
      organization_id uuid,
      booking_id uuid,
      completed_at timestamptz,
      due_at timestamptz NOT NULL
    );
    CREATE TABLE activities (
      id uuid PRIMARY KEY,
      contact_id uuid,
      organization_id uuid,
      booking_id uuid,
      body text NOT NULL,
      occurred_at timestamptz
    );
  `);

  for (let index = 1; index <= 65; index += 1) {
    const contactId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    await client.query(
      `INSERT INTO contacts (id, first_name, last_name, postal_code)
       VALUES ($1, $2, $3, $4)`,
      [contactId, "Unrelated", String(index), "99999"],
    );
    await client.query(
      `INSERT INTO follow_ups (contact_id, due_at) VALUES ($1, current_date)`,
      [contactId],
    );
  }

  await client.query(
    `INSERT INTO contacts (id, first_name, last_name, postal_code)
     VALUES ($1, $2, $3, $4)`,
    [targetContactId, "ZIP-only", "Contact", "58103"],
  );
}

beforeAll(async () => {
  client = new PGlite();
  database = drizzle(client);
  databaseContext.database = database;
  await seedZipOnlyCallerFixture();
});

afterAll(async () => {
  if (originalAssistedCallingEnabled === undefined) delete process.env.ASSISTED_CALLING_ENABLED;
  else process.env.ASSISTED_CALLING_ENABLED = originalAssistedCallingEnabled;
  await client.close();
});

describe("caller finder ZIP-only contact matches", () => {
  it("projects a contact postal-code match after query narrowing before the repository cap", async () => {
    const candidates = await new DrizzleContactRepository(database as never).findCallerCandidates({
      normalizedPhone: null,
      phoneFragment: null,
      query: "58103",
      includeNotes: true,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      contactId: targetContactId,
      matchedContactPostalCode: true,
      matchedLocation: false,
    });
  });

  it("scores a real repository ZIP-only contact match as a click-only Location suggestion", async () => {
    const result = await new CallerFinderService(
      new DrizzleContactRepository(database as never),
    ).find({ phone: "", query: "58103" });

    expect(result).toEqual({
      exact: { kind: "none" },
      suggestions: [expect.objectContaining({
        contactId: targetContactId,
        reasons: ["Location"],
        score: 150,
      })],
      canCreate: true,
    });
  });

  it("returns the ZIP-only Location suggestion through the real caller-finder route", async () => {
    process.env.ASSISTED_CALLING_ENABLED = "true";
    const { default: callsRouter } = await import("./calls");
    const app = express();
    app.use(callsRouter);

    const response = await request(app)
      .get("/calls/caller-finder")
      .query({ q: "58103" })
      .expect(200);

    expect(response.body).toEqual({
      exact: { kind: "none" },
      suggestions: [expect.objectContaining({
        contactId: targetContactId,
        reasons: ["Location"],
        score: 150,
      })],
      canCreate: true,
    });
  });
});
