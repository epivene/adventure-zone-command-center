import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  documentSourceMetadata,
  assertAttachmentScope,
} from "./document-source-access";
import { emptySelection, type RunContext } from "./contracts";
let db: PGlite;
const org = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const ctx: RunContext = {
  actor: { id: "owner", role: "owner", connectionId: "g" },
  conversationId: "c",
  runId: "r",
  selection: { ...emptySelection(), organizationIds: [org] },
  grants: [],
  signal: new AbortController().signal,
};
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
CREATE TABLE business_documents(id text, lifecycle text);
CREATE TABLE business_document_links(document_id text,organization_id uuid,booking_id text);
CREATE TABLE bookings(id text,organization_id uuid);
CREATE TABLE booking_opportunities(booking_id text,event_year int);
CREATE TABLE google_workspace_validation_mappings(connection_id text,message_id text,thread_id text,organization_id uuid);
CREATE TABLE google_workspace_profile_email_threads(id text,connection_id text,organization_id uuid);
CREATE TABLE google_workspace_profile_email_thread_sources(conversation_id text,connection_id text,gmail_thread_id text);
INSERT INTO business_documents VALUES ('doc','active');
INSERT INTO bookings VALUES ('booking','${org}');
INSERT INTO business_document_links VALUES ('doc',null,'booking');
INSERT INTO booking_opportunities VALUES ('booking',2027);
INSERT INTO google_workspace_validation_mappings VALUES ('g','message','thread','${org}');
`);
});
afterEach(async () => {
  await db.close();
});
it("uses booking-linked customer/year and rejects relinked or deleted files", async () => {
  expect(await documentSourceMetadata(db, ctx, "doc")).toEqual({
    eventYear: 2027,
  });
  await db.query("UPDATE bookings SET organization_id=$1", [other]);
  await expect(documentSourceMetadata(db, ctx, "doc")).rejects.toThrow(
    "ASSISTANT_TARGET_NOT_IN_BATCH",
  );
  await db.query("UPDATE bookings SET organization_id=$1", [org]);
  await db.exec("INSERT INTO booking_opportunities VALUES ('booking',2028)");
  expect(await documentSourceMetadata(db, ctx, "doc")).toEqual({
    eventYear: null,
  });
  await db.exec("UPDATE business_documents SET lifecycle='deleted'");
  await expect(documentSourceMetadata(db, ctx, "doc")).rejects.toThrow(
    "ASSISTANT_DOCUMENT_UNAVAILABLE",
  );
});
it("keeps document year unknown when any linked booking lacks canonical year metadata", async () => {
  await db.exec(
    `INSERT INTO bookings VALUES ('unknown','${org}'); INSERT INTO business_document_links VALUES ('doc',null,'unknown')`,
  );
  expect(await documentSourceMetadata(db, ctx, "doc")).toEqual({
    eventYear: null,
  });
  await db.exec("INSERT INTO booking_opportunities VALUES ('unknown',2027)");
  expect(await documentSourceMetadata(db, ctx, "doc")).toEqual({
    eventYear: 2027,
  });
  await db.exec(
    "UPDATE booking_opportunities SET event_year=2028 WHERE booking_id='unknown'",
  );
  expect(await documentSourceMetadata(db, ctx, "doc")).toEqual({
    eventYear: null,
  });
});
it("requires actual message/attachment membership and a current customer association", async () => {
  const client: any = {
    getMessageMetadata: vi.fn(async () => ({
      id: "message",
      threadId: "thread",
    })),
    getThreadDetail: vi.fn(async () => ({
      id: "thread",
      messages: [
        {
          id: "message",
          attachments: [{ messageId: "message", attachmentId: "attachment" }],
        },
      ],
    })),
  };
  const source = { messageId: "message", attachmentId: "attachment" };
  await assertAttachmentScope(db, ctx, source, client, "g");
  await expect(
    assertAttachmentScope(
      db,
      ctx,
      { ...source, attachmentId: "invented" },
      client,
      "g",
    ),
  ).rejects.toThrow("ASSISTANT_ATTACHMENT_NOT_FOUND");
  await expect(
    assertAttachmentScope(db, ctx, source, client, "other"),
  ).rejects.toThrow("ASSISTANT_CONNECTION_CHANGED");
  await db.exec("DELETE FROM google_workspace_validation_mappings");
  await expect(
    assertAttachmentScope(db, ctx, source, client, "g"),
  ).rejects.toThrow("ASSISTANT_TARGET_NOT_IN_BATCH");
  await db.exec(
    `INSERT INTO google_workspace_profile_email_threads VALUES('archive','g','${org}'); INSERT INTO google_workspace_profile_email_thread_sources VALUES('archive','g','thread')`,
  );
  await assertAttachmentScope(db, ctx, source, client, "g");
  await expect(
    assertAttachmentScope(
      db,
      { ...ctx, selection: { ...ctx.selection, threadId: "different" } },
      source,
      client,
      "g",
    ),
  ).rejects.toThrow("ASSISTANT_THREAD_CHANGED");
});
