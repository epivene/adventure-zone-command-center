import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { ensureEventFamilySchema, EventFamilyRepository } from "./event-family-repository";

describe("event family suggestion persistence", () => {
  it("uses a fixed-size hashed identity index for arbitrarily large candidate fingerprints", async () => {
    const schemaQueries: string[] = [];
    const pool = {
      async query(text: string) {
        schemaQueries.push(text);
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;

    await ensureEventFamilySchema(pool);

    const schemaSql = schemaQueries.join("\n");
    expect(schemaSql).toContain(
      "DROP CONSTRAINT IF EXISTS event_family_suggestions_normalized_name_candidate_fingerpr_key",
    );
    expect(schemaSql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS event_family_suggestions_identity_hash_unique",
    );
    expect(schemaSql).toContain("md5(candidate_fingerprint)");
    expect(schemaSql).not.toContain("UNIQUE (normalized_name, candidate_fingerprint)");
  });

  it("lets the hashed identity index handle conflicts for a fingerprint larger than the btree row limit", async () => {
    const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
    const client = {
      async query(text: string, values?: readonly unknown[]) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;
    const repository = new EventFamilyRepository(pool);
    const candidateIds = Array.from({ length: 80 }, (_, index) => {
      const suffix = String(index + 1).padStart(12, "0");
      return `00000000-0000-4000-8000-${suffix}`;
    });

    await repository.replacePendingSuggestions([
      {
        proposedName: "Fourth of July",
        normalizedName: "fourth of july",
        candidateIds,
        source: "rule",
        confidence: 1,
        reason: "Names match a reviewed recurring-event alias rule",
      },
    ]);

    const insert = calls.find((call) => call.text.includes("INSERT INTO event_family_suggestions"));
    expect(insert).toBeDefined();
    expect(String(insert?.values?.[3]).length).toBeGreaterThan(2704);
    expect(insert?.text).toContain("ON CONFLICT DO NOTHING");
    expect(insert?.text).not.toContain(
      "ON CONFLICT (normalized_name, candidate_fingerprint)",
    );
  });
});
