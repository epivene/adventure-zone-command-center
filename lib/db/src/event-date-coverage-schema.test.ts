import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as publicSchema from "./drizzle-schema";
import {
  eventDateCoverageItemStatusValues,
  eventDateCoverageItems,
  eventDateCoverageRunStatusValues,
  eventDateCoverageRuns,
  eventDateFactStatusValues,
  eventDateFacts,
} from "./event-date-coverage-schema";

describe("event date coverage schema", () => {
  it("defines facts and resumable coverage jobs", () => {
    expect(getTableName(eventDateFacts)).toBe("event_date_facts");
    expect(getTableName(eventDateCoverageRuns)).toBe("event_date_coverage_runs");
    expect(getTableName(eventDateCoverageItems)).toBe("event_date_coverage_items");
    expect(eventDateFactStatusValues).toEqual([
      "confirmed",
      "expected",
      "needs_review",
    ]);
    expect(eventDateCoverageRunStatusValues).toEqual([
      "queued",
      "researching",
      "complete",
      "failed",
      "cancelled",
    ]);
    expect(eventDateCoverageItemStatusValues).toEqual([
      "queued",
      "researching",
      "complete",
      "needs_review",
      "failed",
      "skipped",
    ]);
  });

  it("exports the tables through the public drizzle schema", () => {
    expect(publicSchema.eventDateFacts).toBe(eventDateFacts);
    expect(publicSchema.eventDateCoverageRuns).toBe(eventDateCoverageRuns);
    expect(publicSchema.eventDateCoverageItems).toBe(eventDateCoverageItems);
  });

  it("stores date evidence, provenance, and supersession history", () => {
    expect(eventDateFacts.organizationId.name).toBe("organization_id");
    expect(eventDateFacts.startsOn.name).toBe("starts_on");
    expect(eventDateFacts.endsOn.name).toBe("ends_on");
    expect(eventDateFacts.recurrenceRule.name).toBe("recurrence_rule");
    expect(eventDateFacts.sourcePointers.name).toBe("source_pointers");
    expect(eventDateFacts.supersededById.name).toBe("superseded_by_id");
    expect(eventDateFacts.active.name).toBe("active");
  });

  it("enforces one active fact and indexes effective-date and lease queries", () => {
    const factConfig = getTableConfig(eventDateFacts);
    const runConfig = getTableConfig(eventDateCoverageRuns);
    const itemConfig = getTableConfig(eventDateCoverageItems);
    const indexNames = [
      ...factConfig.indexes,
      ...runConfig.indexes,
      ...itemConfig.indexes,
    ].map((index) => index.config.name);

    expect(indexNames).toEqual(expect.arrayContaining([
      "event_date_facts_one_active_per_org",
      "event_date_facts_effective_date_idx",
      "event_date_coverage_runs_status_idx",
      "event_date_coverage_items_lease_idx",
      "event_date_coverage_items_run_org_unique",
    ]));
    expect(factConfig.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "event_date_facts_status_valid",
        "event_date_facts_source_kind_valid",
        "event_date_facts_range_valid",
      ]),
    );
  });
});
