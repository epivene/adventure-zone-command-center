import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test"; process.env.SESSION_SECRET = "document-security-secret"; });
import { requireOwnerMiddleware } from "@/lib/auth";
import { createBusinessDocumentsRouter } from "./business-documents";

const documentId = "11111111-1111-4111-8111-111111111111";
describe("business document route security", () => {
  it("never returns storage keys or signed links to office auth", async () => {
    const detail = vi.fn(async () => ({ storageKey: "private/secret.pdf", url: "https://storage.googleapis.com/private" }));
    const service = { detail, list: vi.fn(), open: vi.fn(), unlink: vi.fn(), addLink: vi.fn(), archive: vi.fn(), delete: vi.fn(), pendingReviewCount: vi.fn(), reviewItems: vi.fn(), reviewAction: vi.fn() };
    const app = express(); app.use(express.json()); app.use(requireOwnerMiddleware); app.use(createBusinessDocumentsRouter(service as any));
    const response = await request(app).get(`/business-documents/${documentId}`).set("Authorization", "Bearer office.not-owner.signature").expect(401);
    expect(JSON.stringify(response.body)).not.toContain("storageKey");
    expect(JSON.stringify(response.body)).not.toContain("storage.googleapis.com");
    expect(detail).not.toHaveBeenCalled();
  });
});
