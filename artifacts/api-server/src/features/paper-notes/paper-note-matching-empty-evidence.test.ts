import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildPaperNoteCandidateQuery } from "./paper-note-safe-matching-repository";

const dialect = new PgDialect();

describe("paper note candidate query optional evidence", () => {
  it("omits empty email, contact-name, and extension branches for phone-only review data", () => {
    const query = buildPaperNoteCandidateQuery({
      eventName: "Pocatello Potato Festival",
      eventNameNormalized: "pocatello potato festival",
      city: "Pocatello",
      region: "ID",
      venue: "",
      token: "pocatello",
      phoneNumbers: ["+12082366906"],
      extensions: [],
      emails: [],
      contactNames: [],
    });
    const compiled = dialect.sqlToQuery(query);
    expect(compiled.sql).not.toContain("array[]::text[]");
    expect(compiled.sql).not.toContain("lower(coalesce(c.email");
    expect(compiled.sql).not.toContain("lower(trim(concat_ws(' ', c.first_name, c.last_name)))");
    expect(compiled.sql).toContain('as "exactPhone"');
    expect(compiled.sql).toContain('false as "exactEmail"');
    expect(compiled.sql).toContain('false as "contactNameMatch"');
    expect(compiled.sql).toContain('true as "compatibleExtension"');
  });
});
