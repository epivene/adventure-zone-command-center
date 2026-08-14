import { describe, expect, it, vi } from "vitest";
import type { AiCompletionClient } from "../ai-suggestions/ai-client";
import {
  buildArchiveProfileAiPrompt,
  parseArchiveProfileAiResponse,
  resolveArchiveProfilesWithAi,
  resolveArchiveProfilesWithAiFactory,
  type ArchiveProfileAiDecision,
} from "./archive-profile-ai";
import type { ArchiveProfileAiProjection } from "./archive-profile-import-types";

const contactProjection: ArchiveProfileAiProjection = {
  sourceRecordId: "contact-source-1",
  streamType: "contact",
  supportedFields: {
    firstName: " Ada ",
    lastName: " Lovelace ",
    email: "ada@example.com",
    phone: null,
  },
  contextLabels: ["missing_required_identity"],
};

const companyProjection: ArchiveProfileAiProjection = {
  sourceRecordId: "company-source-1",
  streamType: "company",
  supportedFields: { name: " Orbit Music ", phone: null },
  contextLabels: [],
};

const preserveAll = (
  projections: readonly ArchiveProfileAiProjection[],
  reasonCode: "ai_preserve_requested" | "ai_low_confidence" | "ai_invalid_response",
): readonly ArchiveProfileAiDecision[] =>
  projections.map((projection) => ({
    sourceRecordId: projection.sourceRecordId,
    action: "preserve_for_later" as const,
    confidence: reasonCode === "ai_low_confidence" ? "low" as const : "high" as const,
    reasonCode,
    evidenceLabels: [...projection.contextLabels],
  }));

const response = (decisions: unknown) => JSON.stringify({ decisions });

const clientReturning = (value: string): AiCompletionClient => ({
  providerName: "test",
  complete: async () => value,
});

describe("archive profile AI fallback", () => {
  it("builds a prompt from the redacted projections and rejects batches over twenty", () => {
    const projectionWithForbiddenData = {
      ...contactProjection,
      rawSnapshot: { notes: "do not expose" },
      notes: "do not expose",
    } as ArchiveProfileAiProjection;

    const prompt = buildArchiveProfileAiPrompt([projectionWithForbiddenData]);

    expect(prompt).not.toContain("rawSnapshot");
    expect(prompt).not.toContain("notes");
    expect(prompt).not.toContain("do not expose");
    expect(() => buildArchiveProfileAiPrompt(new Array(21).fill(contactProjection))).toThrow("ai_batch_too_large");
  });

  it("preserves every record when the provider response is malformed", () => {
    expect(parseArchiveProfileAiResponse("not json", [contactProjection])).toEqual(
      preserveAll([contactProjection], "ai_invalid_response"),
    );
  });

  it.each([
    ["duplicate IDs", [contactProjection, companyProjection], response([
      { sourceRecordId: "contact-source-1", action: "preserve_for_later", confidence: "high" },
      { sourceRecordId: "contact-source-1", action: "preserve_for_later", confidence: "high" },
    ])],
    ["missing IDs", [contactProjection, companyProjection], response([
      { sourceRecordId: "contact-source-1", action: "preserve_for_later", confidence: "high" },
    ])],
    ["unknown IDs", [contactProjection, companyProjection], response([
      { sourceRecordId: "contact-source-1", action: "preserve_for_later", confidence: "high" },
      { sourceRecordId: "unknown-source", action: "preserve_for_later", confidence: "high" },
    ])],
  ])("preserves every record when the response contains %s", (_name, projections, text) => {
    expect(parseArchiveProfileAiResponse(text, projections)).toEqual(
      preserveAll(projections, "ai_invalid_response"),
    );
  });

  it("preserves a low-confidence create request", () => {
    const lowConfidenceJson = response([
      {
        sourceRecordId: "contact-source-1",
        action: "create_profile",
        confidence: "low",
        values: { firstName: "Ada", lastName: "Lovelace" },
      },
    ]);

    expect(parseArchiveProfileAiResponse(lowConfidenceJson, [contactProjection])).toEqual(
      preserveAll([contactProjection], "ai_low_confidence"),
    );
  });

  it("creates only profiles whose AI values normalize to a required identity", () => {
    const valid = response([
      {
        sourceRecordId: "contact-source-1",
        action: "create_profile",
        confidence: "medium",
        values: { firstName: " Ada ", lastName: " Lovelace ", email: "ada@example.com" },
      },
    ]);
    const matchingButMissingRequiredIdentity = response([
      {
        sourceRecordId: "contact-source-1",
        action: "create_profile",
        confidence: "high",
        values: { firstName: " Ada " },
      },
    ]);
    const emptyValues = response([
      {
        sourceRecordId: "contact-source-1",
        action: "create_profile",
        confidence: "high",
        values: {},
      },
    ]);

    expect(parseArchiveProfileAiResponse(valid, [contactProjection])).toEqual([
      {
        sourceRecordId: "contact-source-1",
        action: "create_profile",
        confidence: "medium",
        values: {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
        },
        evidenceLabels: ["missing_required_identity"],
      },
    ]);
    expect(parseArchiveProfileAiResponse(matchingButMissingRequiredIdentity, [contactProjection])).toEqual(
      preserveAll([contactProjection], "ai_invalid_response"),
    );
    expect(parseArchiveProfileAiResponse(emptyValues, [contactProjection])).toEqual(
      preserveAll([contactProjection], "ai_invalid_response"),
    );
  });

  it("does not allow AI output to add unsupported profile fields", () => {
    const withUnsupportedField = response([
      {
        sourceRecordId: "company-source-1",
        action: "create_profile",
        confidence: "high",
        values: { name: "Orbit Music", notes: "private" },
      },
    ]);

    expect(parseArchiveProfileAiResponse(withUnsupportedField, [companyProjection])).toEqual(
      preserveAll([companyProjection], "ai_invalid_response"),
    );
  });

  it("classifies a missing provider before an AI client is created", async () => {
    const unavailable = Object.assign(new Error("private provider detail"), {
      code: "NO_AI_PROVIDER_CONFIGURED",
    });

    await expect(resolveArchiveProfilesWithAiFactory(async () => { throw unavailable; }, [contactProjection])).resolves.toEqual([
      {
        sourceRecordId: "contact-source-1",
        action: "retry_later",
        reasonCode: "ai_unavailable",
        evidenceLabels: ["missing_required_identity"],
      },
    ]);
  });

  it("returns timeout decisions when the provider times out", async () => {
    const timeout = Object.assign(new Error("private timeout detail"), { name: "TimeoutError" });
    const client: AiCompletionClient = {
      providerName: "test",
      complete: async () => { throw timeout; },
    };

    await expect(resolveArchiveProfilesWithAi(client, [contactProjection])).resolves.toEqual([
      {
        sourceRecordId: "contact-source-1",
        action: "retry_later",
        reasonCode: "ai_timeout",
        evidenceLabels: ["missing_required_identity"],
      },
    ]);
  });

  it.each([
    Object.assign(new Error("private provider detail"), { name: "AbortError" }),
    Object.assign(new Error("private provider detail"), { name: "APIConnectionTimeoutError" }),
    Object.assign(new Error("private provider detail"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    Object.assign(new Error("private provider detail"), { code: "ETIMEDOUT" }),
  ])("classifies provider-neutral timeout shape %s as retryable", async (timeout) => {
    const client: AiCompletionClient = {
      providerName: "test",
      complete: async () => { throw timeout; },
    };

    await expect(resolveArchiveProfilesWithAi(client, [contactProjection])).resolves.toMatchObject([
      { action: "retry_later", reasonCode: "ai_timeout" },
    ]);
  });

  it("bounds a non-responsive provider call with timeout decisions", async () => {
    vi.useFakeTimers();
    const client: AiCompletionClient = {
      providerName: "test",
      complete: () => new Promise<string>(() => undefined),
    };

    const result = resolveArchiveProfilesWithAi(client, [contactProjection]);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toEqual([
      {
        sourceRecordId: "contact-source-1",
        action: "retry_later",
        reasonCode: "ai_timeout",
        evidenceLabels: ["missing_required_identity"],
      },
    ]);
    vi.useRealTimers();
  });

  it("returns parsed high-confidence create decisions through the client boundary", async () => {
    await expect(resolveArchiveProfilesWithAi(clientReturning(response([
      {
        sourceRecordId: "company-source-1",
        action: "create_profile",
        confidence: "high",
        values: { name: "Orbit Music", phone: null },
      },
    ])), [companyProjection])).resolves.toMatchObject([
      { sourceRecordId: "company-source-1", action: "create_profile", confidence: "high" },
    ]);
  });
});
