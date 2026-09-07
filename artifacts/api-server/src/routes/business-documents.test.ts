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
    open: vi.fn(async () => "https://signed.example/file"),
    unlink: vi.fn(async () => true),
    addLink: vi.fn(async () => undefined),
    archive: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    pendingReviewCount: vi.fn(async () => 3),
    reviewItems: vi.fn(async () => [{ id: linkId, displayName: "City COI" }]),
    reviewAction: vi.fn(async () => ({ ok: true })),
  };
  const app = express();
  app.use(express.json());
  app.use(requireOwnerMiddleware);
  app.use(createBusinessDocumentsRouter(service as any));
  return { app, service };
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
