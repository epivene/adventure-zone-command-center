import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  PaperNoteMatchingService,
  paperNoteTextArraySql,
} from "./paper-note-matching-service";
import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";

const review: PaperNoteReviewDraft = {
  event: {
    name: "Emmett Cherry Festival",
    city: "Emmett",
    region: "ID",
    venue: "",
    eventDateText: "",
    startsOn: null,
    endsOn: null,
    pageYearConfirmed: false,
  },
  activity: { occurredOn: null, method: "call", outcome: "", summary: "" },
  contacts: [{
    key: "contact-0",
    mode: "new_contact",
    selectedContactId: null,
    name: "Tina",
    role: null,
    email: "tina@example.com",
    primary: true,
    phones: [{
      key: "phone-0",
      number: "208-555-0142",
      extension: "3115",
      type: "office",
      label: null,
      instructions: null,
      status: "active",
      primary: true,
      crossedOut: false,
      importAsStructuredValue: true,
    }],
  }],
  organizationPhones: [],
  oldReminder: "",
  starredOnPaper: false,
  generalNotes: [],
  destination: null,
  conflicts: {},
  currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
};

describe("paperNoteTextArraySql", () => {
  const dialect = new PgDialect();

  it("renders an actual empty Postgres text array instead of ()::text[]", () => {
    const query = dialect.sqlToQuery(paperNoteTextArraySql([]));
    expect(query.sql.toLowerCase()).toBe("array[]::text[]");
    expect(query.params).toEqual([]);
  });

  it("renders values as a parameterized Postgres ARRAY expression", () => {
    const query = dialect.sqlToQuery(paperNoteTextArraySql(["+14358906349"]));
    expect(query.sql.toLowerCase()).toBe("array[$1]::text[]");
    expect(query.params).toEqual(["+14358906349"]);
  });
});

describe("PaperNoteMatchingService", () => {
  it("ranks exact phone/email evidence above name-only possibilities", async () => {
    const repository = {
      findCandidates: vi.fn(async () => [
        {
          organizationId: "10000000-0000-4000-8000-000000000001",
          organizationLocationId: null,
          name: "Emmett Cherry Festival",
          city: "Emmett",
          region: "ID",
          exactPhone: true,
          compatibleExtension: true,
          exactEmail: true,
          exactName: true,
          sameCityRegion: true,
          venueMatch: false,
          contactNameMatch: true,
        },
        {
          organizationId: "10000000-0000-4000-8000-000000000002",
          organizationLocationId: null,
          name: "Emmett Cherry Fest",
          city: "Boise",
          region: "ID",
          exactPhone: false,
          compatibleExtension: false,
          exactEmail: false,
          exactName: false,
          sameCityRegion: false,
          venueMatch: false,
          contactNameMatch: false,
        },
      ]),
    };
    const matches = await new PaperNoteMatchingService(repository as any).match(review);
    expect(matches[0]).toMatchObject({
      organizationId: "10000000-0000-4000-8000-000000000001",
      strength: "strong",
    });
    expect(matches[0]?.reasons).toEqual(expect.arrayContaining([
      "same phone number and extension",
      "same email address",
      "same event/profile name and city/state",
    ]));
    expect(matches[1]?.strength).toBe("possible");
  });

  it("returns at most five suggestions and never selects one as the destination", async () => {
    const repository = {
      findCandidates: vi.fn(async () => Array.from({ length: 9 }, (_, index) => ({
        organizationId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        organizationLocationId: null,
        name: `Candidate ${index + 1}`,
        city: "Emmett",
        region: "ID",
        exactPhone: false,
        compatibleExtension: false,
        exactEmail: false,
        exactName: false,
        sameCityRegion: true,
        venueMatch: false,
        contactNameMatch: false,
      }))),
    };
    const matches = await new PaperNoteMatchingService(repository as any).match(review);
    expect(matches).toHaveLength(5);
    expect(review.destination).toBeNull();
  });
});
