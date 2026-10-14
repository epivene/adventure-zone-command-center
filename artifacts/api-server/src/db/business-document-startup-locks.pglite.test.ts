import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import {
  BUSINESS_DOCUMENT_SCHEMA_SQL,
  BUSINESS_DOCUMENT_CATEGORY_REPAIR_SQL,
} from "./business-document-required-startup";
it("keeps installed constraints intact while still repairing older categories", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE organizations(id uuid PRIMARY KEY); CREATE TABLE bookings(id uuid PRIMARY KEY); CREATE TABLE event_families(id uuid PRIMARY KEY); CREATE TABLE office_accounts(id uuid PRIMARY KEY); CREATE TABLE design_certificates(id uuid PRIMARY KEY);",
    );
    await db.exec(BUSINESS_DOCUMENT_SCHEMA_SQL);
    const constraints = () =>
      db.query(
        "SELECT oid,conname FROM pg_constraint WHERE conrelid='business_documents'::regclass ORDER BY conname",
      );
    const before = await constraints();
    await db.exec(BUSINESS_DOCUMENT_SCHEMA_SQL);
    expect(await constraints()).toEqual(before);
    await db.exec(
      "ALTER TABLE business_documents DROP CONSTRAINT business_documents_category_valid; ALTER TABLE business_documents ADD CONSTRAINT business_documents_category_check CHECK(category IN ('other'));",
    );
    await db.exec(BUSINESS_DOCUMENT_CATEGORY_REPAIR_SQL);
    await db.exec(
      "INSERT INTO business_documents(display_name,original_filename,category,created_by) VALUES('Invoice','invoice.pdf','invoice','owner')",
    );
    await expect(
      db.exec(
        "INSERT INTO business_documents(display_name,original_filename,category,created_by) VALUES('Invalid','x','invalid','owner')",
      ),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
