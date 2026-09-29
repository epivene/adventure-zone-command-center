import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";

import * as coverageSchema from "@workspace/db/event-date-coverage-schema";
import { EventDateRepository } from "@/features/event-date-coverage/event-date-repository";
import { ProfileResearchApplyService } from "./profile-research-apply";

describe("profile research event date apply", () => {
  it("creates a date fact without changing the historical booking", async () => {
    const client = new PGlite();
    await client.exec(`
      CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL);
      CREATE TABLE bookings (
        id uuid PRIMARY KEY,
        organization_id uuid REFERENCES organizations(id),
        starts_at timestamptz,
        ends_at timestamptz
      );
      INSERT INTO organizations VALUES ('11111111-1111-4111-8111-111111111111', 'River Days');
      INSERT INTO bookings VALUES (
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        '2026-07-18T17:00:00Z',
        '2026-07-20T17:00:00Z'
      );
    `);
    const migration = await readFile(
      new URL("../../../../../lib/db/migrations/20260921_event_date_coverage.sql", import.meta.url),
      "utf8",
    );
    await client.exec(migration);
    const eventDates = new EventDateRepository(drizzle(client, { schema: coverageSchema }));
    const source = {
      id: "source-1",
      kind: "web" as const,
      title: "Official River Days",
      url: "https://riverdays.example/dates",
      publisher: "riverdays.example",
      retrievedAt: "2026-09-21T12:00:00.000Z",
      excerpt: "September 5–7, 2027",
    };
    const runs = {
      getRun: vi.fn().mockResolvedValue({
        id: "run-1",
        profileId: "11111111-1111-4111-8111-111111111111",
        status: "complete",
        sources: [source],
        suggestions: [{
          id: "suggestion-1",
          targetKind: "event_date_fact",
          targetId: null,
          field: "eventDate",
          currentValue: null,
          suggestedValue: JSON.stringify({
            startsOn: "2027-09-05",
            endsOn: "2027-09-07",
            evidenceKind: "published_exact",
            recurrenceRule: null,
            sourceId: source.id,
            confidence: 0.98,
          }),
          confidence: "high",
          rationale: "Official published dates",
          sourceIds: [source.id],
          conflict: false,
          reviewStatus: "pending",
        }],
      }),
      setSuggestionReview: vi.fn().mockResolvedValue(true),
    };
    const forbiddenBookingWriter = {
      transaction: () => {
        throw new Error("historical booking write attempted");
      },
    };
    const before = await client.query("SELECT starts_at, ends_at FROM bookings");
    const service = new ProfileResearchApplyService(
      runs as any,
      forbiddenBookingWriter as any,
      eventDates,
    );

    const result = await service.apply({
      profileId: "11111111-1111-4111-8111-111111111111",
      runId: "run-1",
      suggestionIds: ["suggestion-1"],
    });

    expect(result).toEqual({ applied: ["suggestion-1"], stale: [], invalid: [], missing: [] });
    expect((await client.query("SELECT starts_at, ends_at FROM bookings")).rows)
      .toEqual(before.rows);
    expect(await eventDates.listActiveFacts(["11111111-1111-4111-8111-111111111111"]))
      .toEqual(new Map([[
        "11111111-1111-4111-8111-111111111111",
        [expect.objectContaining({ startsOn: "2027-09-05", status: "confirmed" })],
      ]]));

    runs.getRun.mockResolvedValue({
      id: "run-2",
      profileId: "11111111-1111-4111-8111-111111111111",
      status: "complete",
      sources: [source],
      suggestions: [{
        id: "suggestion-2",
        targetKind: "event_date_fact",
        suggestedValue: JSON.stringify({
          startsOn: "2027-09-06", endsOn: null, evidenceKind: "published_exact",
          recurrenceRule: null, sourceId: source.id, confidence: 0.7,
        }),
        confidence: "medium", rationale: "Uncertain published date", conflict: false,
        reviewStatus: "pending",
      }],
    });
    expect((await service.apply({ profileId: "11111111-1111-4111-8111-111111111111", runId: "run-2", suggestionIds: ["suggestion-2"] })).applied)
      .toEqual(["suggestion-2"]);
    expect(await eventDates.listFacts("11111111-1111-4111-8111-111111111111"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ startsOn: "2027-09-06", status: "needs_review" })]));
    await client.close();
  });
});
