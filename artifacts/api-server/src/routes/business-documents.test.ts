import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test";
  process.env.OWNER_PASSWORD = "owner-password";
  process.env.SESSION_SECRET = "business-document-test-secret";
});

import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { createBusinessDocumentsRouter } from "./business-documents";

const documentId = "11111111-1111-4111-8111-111111111111";
const linkId = "22222222-2222-4222-8222-222222222222";

function setup() {
  const service = {
    list: vi.fn(async () => []),
    detail: vi.fn(async () => null),
    update: vi.fn(async () => ({ id: documentId, displayName: "Updated contract" })),
    open: vi.fn(async () => "https://signed.example/file"),
    unlink: vi.fn(async () => true),
    addLink: vi.fn(async () => undefined),
    archive: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    pendingReviewCount: vi.fn(async () => 3),
    reviewItems: vi.fn(async () => [{ id: linkId, displayName: "City COI" }]),
    reviewAction: vi.fn(async () => ({ ok: true })),
  };
  const ingestion = {
    ingest: vi.fn(async () => ({
      outcome: "imported" as const,
      documentId,
      versionId: "33333333-3333-4333-8333-333333333333",
      blobId: "44444444-4444-4444-8444-444444444444",
      reviewState: "accepted" as const,
      linkedProfileIds: [],
      linkedBookingIds: [],
      linkedEventFamilyIds: [],
    })),
  };
  const app = express();
  app.use(express.json());
  app.use(requireOwnerMiddleware);
  app.use(createBusinessDocumentsRouter(service as any, ingestion as any));
  return { app, service, ingestion };
}

function ownerHeader() {
  const issued = issueToken();
  if (!issued) throw new Error("test owner token unavailable");
  return { Authorization: `Bearer ${issued.token}` };
}

beforeEach(() => vi.clearAllMocks());

describe("business document routes", () => {
  it("does not expose metadata or signed URLs without owner auth", async () => {
    const { app } = setup();
    await request(app).get("/business-documents").expect(401);
    await request(app).post(`/business-documents/${documentId}/open`).expect(401);
  });

  it("returns the pending review count to an owner", async () => {
    const { app } = setup();
    const response = await request(app).get("/business-documents/review-count").set(ownerHeader()).expect(200);
    expect(response.body).toEqual({ count: 3 });
  });

  it("forwards a bounded offset so the document library can load later pages", async () => {
    const { app, service } = setup();

    await request(app).get("/business-documents?limit=100&offset=200").set(ownerHeader()).expect(200);

    expect(service.list).toHaveBeenCalledWith({ limit: 100, offset: 200 });
  });

  it("ingests an owner-uploaded document into protected business storage", async () => {
    const { app, ingestion } = setup();
    const response = await request(app)
      .post("/business-documents/upload")
      .set(ownerHeader())
      .set("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .set("x-file-name", encodeURIComponent("Art City Days Proposal.docx"))
      .send(Buffer.from([1, 2, 3]))
      .expect(201);

    expect(response.body).toEqual(expect.objectContaining({ outcome: "imported", documentId }));
    expect(ingestion.ingest).toHaveBeenCalledWith(expect.objectContaining({
      filename: "Art City Days Proposal.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      source: expect.objectContaining({ sourceKind: "manual" }),
    }));
  });

  it("applies the supplied display name and category to an uploaded document", async () => {
    const { app, service } = setup();
    await request(app)
      .post("/business-documents/upload")
      .set(ownerHeader())
      .set("content-type", "application/pdf")
      .set("x-file-name", encodeURIComponent("raw-file.pdf"))
      .set("x-document-name", encodeURIComponent("County Fair Agreement"))
      .set("x-document-category", "contract")
      .send(Buffer.from([1, 2, 3]))
      .expect(201);

    expect(service.update).toHaveBeenCalledWith(documentId, {
      displayName: "County Fair Agreement",
      category: "contract",
      notes: null,
    }, "");
  });

  it("rejects an upload without a safe filename", async () => {
    const { app, ingestion } = setup();
    await request(app)
      .post("/business-documents/upload")
      .set(ownerHeader())
      .set("content-type", "application/pdf")
      .send(Buffer.from([1]))
      .expect(400);
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it("unlinks a profile without deleting the document", async () => {
    const { app, service } = setup();
    await request(app).delete(`/business-documents/${documentId}/links/${linkId}`).set(ownerHeader()).expect(200, { ok: true });
    expect(service.unlink).toHaveBeenCalledWith(documentId, linkId, "");
    expect(service.delete).not.toHaveBeenCalled();
  });

  it("requires an explicit DELETE confirmation for destructive removal", async () => {
    const { app, service } = setup();
    await request(app).delete(`/business-documents/${documentId}`).set(ownerHeader()).send({ confirmation: "no" }).expect(400);
    expect(service.delete).not.toHaveBeenCalled();
  });

  it("validates and applies editable document metadata", async () => {
    const { app, service } = setup();
    const body = { displayName: "Updated contract", category: "contract", notes: "Signed copy" };

    await request(app).patch(`/business-documents/${documentId}`).set(ownerHeader()).send(body).expect(200);
    expect(service.update).toHaveBeenCalledWith(documentId, body, "");

    await request(app).patch(`/business-documents/${documentId}`).set(ownerHeader()).send({ ...body, displayName: "   " }).expect(400);
  });

  it("lists and resolves document reviews separately from the document list", async () => {
    const { app, service } = setup();
    await request(app).get("/business-documents/reviews").set(ownerHeader()).expect(200);
    await request(app).post(`/business-documents/reviews/${linkId}/actions`).set(ownerHeader()).send({ action: "approve" }).expect(200, { ok: true });
    expect(service.reviewItems).toHaveBeenCalledWith(50);
    expect(service.reviewAction).toHaveBeenCalledWith(linkId, { action: "approve" }, "");
  });

  it("validates corrections before correct-and-approve", async () => {
    const { app, service } = setup();
    await request(app).post(`/business-documents/reviews/${linkId}/actions`).set(ownerHeader()).send({ action: "correct_and_approve", corrections: {} }).expect(400);
    expect(service.reviewAction).not.toHaveBeenCalled();
  });
});
