import { describe, expect, it } from "vitest";
import { PostgresProfileSearchRepository, rankProfileSearchResults } from "./profile-search-repository";
import type { AssistantProfileSearchResult } from "./profile-search-types";

function row(overrides: Partial<AssistantProfileSearchResult>): AssistantProfileSearchResult {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    kind: overrides.kind ?? "organization",
    label: overrides.label ?? "Example Fair",
    secondaryLabel: overrides.secondaryLabel ?? null,
    city: overrides.city ?? null,
    region: overrides.region ?? null,
    status: overrides.status ?? null,
    lastContactAt: overrides.lastContactAt ?? null,
    bookingCount: overrides.bookingCount ?? null,
    matchedOn: overrides.matchedOn ?? ["name"],
  };
}

describe("rankProfileSearchResults", () => {
  it("ranks exact names before partial/contact/location matches", () => {
    const results = rankProfileSearchResults([
      row({ id: "3", label: "Morton County Fairgrounds", matchedOn: ["name"] }),
      row({ id: "2", label: "Lisa Doe", kind: "contact", matchedOn: ["contact"] }),
      row({ id: "1", label: "Morton County Fair", matchedOn: ["name"] }),
    ], "Morton County Fair", 8);
    expect(results.map((item) => item.id)).toEqual(["1", "3", "2"]);
  });

  it("gives booking-name matches useful rank for event discovery", () => {
    const results = rankProfileSearchResults([
      row({ id: "1", label: "City of Dickinson", matchedOn: ["booking"] }),
      row({ id: "2", label: "Unrelated Profile", matchedOn: ["region"] }),
    ], "Christmas", 8);
    expect(results[0]?.id).toBe("1");
  });

  it("deduplicates canonical result ids and respects the bound", () => {
    const repeated = row({ id: "same", label: "Water Lantern Festival" });
    const rows = [repeated, repeated, ...Array.from({ length: 12 }, (_, index) => row({ id: String(index), label: `Profile ${index}` }))];
    const results = rankProfileSearchResults(rows, "profile", 8);
    expect(results).toHaveLength(8);
    expect(new Set(results.map((item) => `${item.kind}:${item.id}`)).size).toBe(8);
  });
});

describe("PostgresProfileSearchRepository", () => {
  it("normalizes union status and optional search parameter types", async () => {
    let sql = "";
    const pool = {
      async query(text: string) {
        sql = text;
        return { rows: [] };
      },
    };

    const repository = new PostgresProfileSearchRepository(pool as never);
    await repository.search({ query: "Pirate's Rebellion", limit: 8 });

    expect(sql).toContain("SELECT b.status::text FROM bookings b");
    expect(sql).toContain("$3::text");
    expect(sql).toContain("$4::text");
    expect(sql).toContain("$5::text");
    expect(sql).toContain("$6::boolean");
    expect(sql).toContain("'%' || $5::text || '%'");
  });

  it("searches booking names so seasonal events can find their owning profile", async () => {
    let sql = "";
    const pool = {
      async query(text: string) {
        sql = text;
        return { rows: [] };
      },
    };

    const repository = new PostgresProfileSearchRepository(pool as never);
    await repository.search({ query: "Christmas", limit: 8 });

    expect(sql).toContain("b.name ILIKE $2");
    expect(sql).toContain("THEN 'booking' END");
  });

  it("searches names visible after profile consolidation and event-family grouping", async () => {
    let sql = "";
    const pool = {
      async query(text: string) {
        sql = text;
        return { rows: [] };
      },
    };

    const repository = new PostgresProfileSearchRepository(pool as never);
    await repository.search({ query: "Christmas", limit: 8 });

    expect(sql).toContain("FROM organization_locations ol");
    expect(sql).toContain("ol.label ILIKE $2");
    expect(sql).toContain("ol.venue_name ILIKE $2");
    expect(sql).toContain("ol.act_source_label ILIKE $2");
    expect(sql).toContain("ef.normalized_name ILIKE $2");
    expect(sql).toContain("ef.description ILIKE $2");
  });
});