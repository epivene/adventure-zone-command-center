import express from "express";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";

import { ContractDraftServiceError } from "@/features/contracts/contract-draft-service";
import { isContractBuilderEnabled } from "@/features/contracts/contract-feature-enabled";
import { issueToken, requireOwnerMiddleware } from "@/lib/auth";
import { guaranteedFeeSnapshot } from "@/features/contracts/fixtures/guaranteed-fee.snapshot";
import { createContractsRouter, type ContractRouteServices } from "./contracts";

const draft = { id: "draft-1", revision: 1 };
const version = { id: "version-1", status: "ready_for_adobe" };

function services(): ContractRouteServices {
  return {
    drafts: {
      start: async ({ bookingId }) => bookingId === "missing"
        ? Promise.reject(new ContractDraftServiceError("CONTRACT_BOOKING_NOT_FOUND", "Booking not found."))
        : { draft, reused: bookingId === "resume" },
      save: async ({ expectedRevision }) => expectedRevision === 99
        ? Promise.reject(new ContractDraftServiceError("CONTRACT_DRAFT_STALE", "stale", { currentRevision: 2 }))
        : ({ ...draft, revision: expectedRevision + 1 }),
      finalize: async () => ({ version, reused: false }),
      createReplacement: async () => draft,
    },
    queries: {
      listOrganization: async (organizationId) => ({ organizationId, contracts: [version], eligibleBookings: [] }),
      listBooking: async (bookingId) => ({ bookingId, contracts: [version], openDraft: null }),
      getVersion: async (versionId) => versionId === "missing" ? null : ({ ...version, id: versionId, files: [] }),
      getDraft: async (draftId) => draftId === "missing" ? null : ({ ...draft, id: draftId }),
    },
    files: {
      open: async ({ fileId }) => fileId === "unavailable"
        ? Promise.reject(new Error("gs://secret-bucket/private-key"))
        : "https://private.example/five-minute-link",
      storeSigned: async ({ originalFilename }) => ({ id: "signed-1", kind: "signed_completed", revision: 1, originalFilename, confirmedAt: null }),
    },
    lifecycle: {
      confirmAdobeSent: async ({ contractVersionId }) => ({ state: { contractVersionId, contractStatus: "sent_for_signature" }, reused: false }),
      transition: async ({ contractVersionId, toStatus }) => ({ state: { contractVersionId, contractStatus: toStatus }, reused: false }),
      confirmSignedFile: async ({ contractVersionId, fileId }) => ({ state: { contractVersionId, contractStatus: "completed", confirmedFileId: fileId }, reused: false }),
    },
    coi: { createOrRecover: async ({ contractVersionId }) => ({ record: { contractVersionId, state: "created", recipientEmail: "sara@protectiveins.net" }, reused: false }) },
    settings: {
      get: async () => ({ internalSignerName: "Dave Gordon", internalSignerEmail: "dave@example.com", internalSignerOrder: 2, insuranceRecipientName: "Sara Toone", insuranceRecipientEmail: "sara@protectiveins.net" }),
      update: async (input) => ({ ...input, internalSignerOrder: 2 }),
    },
  };
}

function app(input: { enabled?: boolean; authenticated?: boolean; routeServices?: ContractRouteServices } = {}) {
  const instance = express();
  instance.use(express.json());
  if (input.authenticated !== false) instance.use(requireOwnerMiddleware);
  instance.use(createContractsRouter({ enabled: input.enabled ?? true, services: input.routeServices ?? services() }));
  return instance;
}

function authorization() {
  const token = issueToken();
  if (!token) throw new Error("test owner token unavailable");
  return `Bearer ${token.token}`;
}

beforeEach(() => {
  process.env.SESSION_SECRET = "contracts-test-secret";
});

describe("contract feature flag", () => {
  it("is enabled only by the exact true value", () => {
    expect(isContractBuilderEnabled("true")).toBe(true);
    expect(isContractBuilderEnabled("TRUE")).toBe(false);
    expect(isContractBuilderEnabled(undefined)).toBe(false);
  });

  it("returns 404 for every contract route when disabled", async () => {
    await request(app({ enabled: false })).get("/contracts/settings").set("Authorization", authorization()).expect(200, { enabled: false });
    await request(app({ enabled: false })).post("/bookings/booking-1/contract-draft").set("Authorization", authorization()).expect(404);
  });

  it("stays behind the owner authentication boundary", async () => {
    await request(app()).post("/bookings/booking-1/contract-draft").expect(401);
  });

  it("is mounted after the owner middleware in the application router", async () => {
    const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
    expect(source.indexOf("router.use(contractsRouter)")).toBeGreaterThan(source.indexOf("router.use(requireOwnerMiddleware)"));
  });
});

describe("owner contract routes", () => {
  it("reads and validates future-draft settings with fixed signer order", async () => {
    await request(app()).get("/contracts/settings").set("Authorization", authorization()).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ enabled: true, internalSignerName: "Dave Gordon", internalSignerOrder: 2, insuranceRecipientEmail: "sara@protectiveins.net" }));
    await request(app()).patch("/contracts/settings").set("Authorization", authorization()).send({ internalSignerName: "Dave Gordon", internalSignerEmail: "invalid", insuranceRecipientName: "Sara Toone", insuranceRecipientEmail: "sara@protectiveins.net" }).expect(400);
    await request(app()).patch("/contracts/settings").set("Authorization", authorization()).send({ internalSignerName: "Dave Gordon", internalSignerEmail: "dave@example.com", insuranceRecipientName: "Sara Toone", insuranceRecipientEmail: "sara@protectiveins.net", internalSignerOrder: 1 }).expect(400);
  });
  it("starts and resumes a booking draft", async () => {
    await request(app()).post("/bookings/booking-1/contract-draft").set("Authorization", authorization()).expect(201, { draft, reused: false });
    await request(app()).post("/bookings/resume/contract-draft").set("Authorization", authorization()).expect(200, { draft, reused: true });
  });

  it("saves revisions and returns a safe conflict", async () => {
    await request(app()).patch("/contract-drafts/draft-1").set("Authorization", authorization())
      .send({ expectedRevision: 1, values: guaranteedFeeSnapshot }).expect(200)
      .expect(({ body }) => expect(body.draft.revision).toBe(2));
    await request(app()).patch("/contract-drafts/draft-1").set("Authorization", authorization())
      .send({ expectedRevision: 99, values: guaranteedFeeSnapshot }).expect(409, {
        error: "This contract changed in another session. Refresh before saving.", currentRevision: 2,
      });
  });

  it("finalizes, lists, reads, and creates a replacement", async () => {
    await request(app()).post("/contract-drafts/draft-1/finalize").set("Authorization", authorization()).expect(201, { version, reused: false });
    await request(app()).get("/organizations/org-1/contracts").set("Authorization", authorization()).expect(200)
      .expect(({ body }) => expect(body.contracts).toHaveLength(1));
    await request(app()).get("/contracts/version-1").set("Authorization", authorization()).expect(200)
      .expect(({ body }) => expect(body.version.id).toBe("version-1"));
    await request(app()).post("/contracts/version-1/replacement").set("Authorization", authorization()).expect(201, { draft });
    await request(app()).post("/contracts/version-1/confirm-adobe-sent").set("Authorization", authorization()).expect(200)
      .expect(({ body }) => expect(body.state.contractStatus).toBe("sent_for_signature"));
    await request(app()).post("/contracts/version-1/status").set("Authorization", authorization()).send({ status: "partially_signed" }).expect(200)
      .expect(({ body }) => expect(body.state.contractStatus).toBe("partially_signed"));
  });

  it("maps missing records and malformed input without exposing internals", async () => {
    await request(app()).post("/bookings/missing/contract-draft").set("Authorization", authorization()).expect(404, { error: "Booking not found." });
    await request(app()).patch("/contract-drafts/draft-1").set("Authorization", authorization()).send({ expectedRevision: "one" }).expect(400)
      .expect(({ body }) => expect(JSON.stringify(body)).not.toContain("Zod"));
    await request(app()).get("/contracts/missing").set("Authorization", authorization()).expect(404, { error: "Contract version not found." });
  });

  it("returns a short-lived URL without exposing its storage key or provider error", async () => {
    const opened = await request(app()).post("/contracts/version-1/file/open").set("Authorization", authorization()).send({ fileId: "file-1" }).expect(200);
    expect(opened.body.url).toMatch(/^https:\/\//);
    expect(JSON.stringify(opened.body)).not.toContain("storageKey");
    const unavailable = await request(app()).post("/contracts/version-1/file/open").set("Authorization", authorization()).send({ fileId: "unavailable" }).expect(503);
    expect(JSON.stringify(unavailable.body)).not.toContain("secret-bucket");
  });

  it("stores raw signed PDF bytes without completing until explicit confirmation", async () => {
    const uploaded = await request(app()).put("/contracts/version-1/signed-file").set("Authorization", authorization())
      .set("Content-Type", "application/pdf").set("X-File-Name", "signed agreement.pdf")
      .send(Buffer.from("%PDF-1.7\nsigned"))
      .expect(201);
    expect(uploaded.body.file).toMatchObject({ id: "signed-1", originalFilename: "signed agreement.pdf", confirmedAt: null });
    await request(app()).post("/contracts/version-1/signed-file/signed-1/confirm").set("Authorization", authorization())
      .send({ confirmed: true }).expect(200)
      .expect(({ body }) => {
        expect(body.state.contractStatus).toBe("completed");
        expect(body.coiDraft).toMatchObject({ state: "created", recipientEmail: "sara@protectiveins.net" });
      });
    await request(app()).post("/contracts/version-1/coi-draft/retry").set("Authorization", authorization()).expect(200)
      .expect(({ body }) => expect(body.coiDraft.state).toBe("created"));
  });
});
