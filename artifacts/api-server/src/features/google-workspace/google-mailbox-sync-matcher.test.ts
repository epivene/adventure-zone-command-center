import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { SyncMatcher } from "./google-mailbox-sync-matcher";
it("suggests exact known contacts but leaves new thread assignment for review", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `CREATE TABLE contacts(id text,email text);CREATE TABLE organizations(id text,consolidated_into_id text);CREATE TABLE organization_contacts(contact_id text,organization_id text,active boolean);INSERT INTO contacts VALUES('c','fair@example.com');INSERT INTO organizations VALUES('p',NULL);INSERT INTO organization_contacts VALUES('c','p',true);`,
    );
    const matcher = new SyncMatcher(db as any);
    expect(
      await matcher.candidates(
        ["Fair <fair@example.com>", "owner@example.com"],
        "owner@example.com",
      ),
    ).toEqual(["p"]);
    expect(
      await matcher.candidates(
        ['"fair@example.com" <stranger@example.com>'],
        "owner@example.com",
      ),
    ).toEqual([]);
    await db.exec(
      `INSERT INTO organizations VALUES('p2',NULL);INSERT INTO organization_contacts VALUES('c','p2',true);`,
    );
    expect(
      await matcher.candidates(["fair@example.com"], "owner@example.com"),
    ).toEqual(["p", "p2"]);
  } finally {
    await db.close();
  }
});
