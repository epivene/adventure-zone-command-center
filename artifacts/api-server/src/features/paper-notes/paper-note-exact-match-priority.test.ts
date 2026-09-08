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
    const outerOrderBy = sql.slice(sql.lastIndexOf("order by"));
    expect(outerOrderBy).toContain("case when");
    expect(outerOrderBy).toContain("lower(regexp_replace(trim(org.name)");
    expect(outerOrderBy).toContain("then 0 else 1 end");
    expect(compiled.params.slice(-2)).toEqual([
      "4th of july island park",
      "4th of july island park",
    ]);
  });

  it("does not combine SELECT DISTINCT with a non-selected exact-name ORDER BY expression", () => {
    const query = buildPaperNoteCandidateQuery({
      eventName: "Northwest MT Fair Rodeo",
      eventNameNormalized: "northwest mt fair rodeo",
      city: "Kalispell",
      region: "MT",
      venue: "",
      token: "northwest",
      phoneNumbers: ["+14067585810"],
      extensions: [],
      emails: [],
      contactNames: [],
    });

    const compiled = dialect.sqlToQuery(query);
    const sql = compiled.sql.toLowerCase();

    expect(sql).not.toMatch(/select\s+distinct/);
    expect(sql).toMatch(/order by\s+case when/);
  });
});
