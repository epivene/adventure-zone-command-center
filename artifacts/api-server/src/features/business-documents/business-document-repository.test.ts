import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { BusinessDocumentRepository } from "./business-document-repository";

const checksum = "a".repeat(64);
let database: PGlite;

beforeEach(async () => {
  database = new PGlite();
  await database.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY);
    CREATE TABLE bookings (id uuid PRIMARY KEY);
    CREATE TABLE event_families (id uuid PRIMARY KEY);
    CREATE TABLE office_accounts (id uuid PRIMARY KEY);
    CREATE TABLE design_certificates (id uuid PRIMARY KEY);
  `);
  await database.exec(readFileSync(new URL("../../../../../lib/db/migrations/20260907_business_document_library.sql", import.meta.url), "utf8"));
});

afterEach(async () => database.close());

function repository() {
  return new BusinessDocumentRepository({
    connect: async () => ({
      query: async (text, values) => database.query(text, values as any[]),
      release: () => undefined,
    }),
  });
}

function input(sourceKind: "gmail" | "drive", externalId: string) {
  return {
    displayName: "Certificate of Insurance",
    originalFilename: "coi.pdf",
    category: "coi" as const,
    reviewState: "accepted" as const,
    actor: "owner",
    blob: {
      sha256Hex: checksum,
      storageKey: `business-documents/aa/${checksum}`,
      mimeType: "application/pdf",
      sizeBytes: 42,
    },
    source: {
      sourceKind,
      sourceAccountKey: "workspace",
      externalId,
      originalUrl: null,
      metadata: {},
    },
    links: [],
  };
}

describe("BusinessDocumentRepository", () => {
  it("adds a second source without creating a second blob or document", async () => {
    const repo = repository();
    const first = await repo.ingest(input("gmail", "message-1:attachment-1"));
    const second = await repo.ingest(input("drive", "drive-file-1"));

    expect(first.outcome).toBe("imported");
    expect(second).toMatchObject({ outcome: "deduplicated", documentId: first.documentId });
    expect((await database.query("SELECT id FROM business_document_blobs")).rows).toHaveLength(1);
    expect((await database.query("SELECT id FROM business_documents")).rows).toHaveLength(1);
    expect((await database.query("SELECT id FROM business_document_sources")).rows).toHaveLength(2);
  });

  it("returns the existing source identity without duplicating provenance", async () => {
    const repo = repository();
    const first = await repo.ingest(input("gmail", "message-1:attachment-1"));
    const repeated = await repo.ingest(input("gmail", "message-1:attachment-1"));

    expect(repeated).toMatchObject({ outcome: "deduplicated", documentId: first.documentId });
    expect((await database.query("SELECT id FROM business_document_sources")).rows).toHaveLength(1);
  });
});
