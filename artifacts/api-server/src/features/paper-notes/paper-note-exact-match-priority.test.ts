import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { buildPaperNoteCandidateQuery } from "./paper-note-safe-matching-repository";

const dialect = new PgDialect();

describe("paper note candidate priority", () => {
  it("does not let a state-only match crowd an exact event name out before the candidate limit", () => {
    const query = buildPaperNoteCandidateQuery({
      eventName: "4th of July Island Park",
      eventNameNormalized: "4th of july island park",
      city: "Island Park",
      region: "ID",
      venue: "",
      token: "july",
      phoneNumbers: [],
      extensions: [],
      emails: [],
      contactNames: [],
    });

    const compiled = dialect.sqlToQuery(query);
    const sql = compiled.sql.toLowerCase();
    const where = sql.slice(sql.indexOf("where org.consolidated_into_id"));

    expect(where).not.toMatch(/\bor\s+upper\(coalesce\(org\.region/);
    expect(where).toContain("lower(coalesce(org.city, '')) = lower(");
    expect(where).toContain("upper(coalesce(org.region, '')) =");
    expect(sql).toMatch(/order by\s+case when lower\(regexp_replace\(trim\(org\.name\)/);
  });
});
