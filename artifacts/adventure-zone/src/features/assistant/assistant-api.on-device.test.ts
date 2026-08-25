// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));
const cache = vi.hoisted(() => ({
  getAssistantSnapshot: vi.fn(),
  saveAssistantSnapshot: vi.fn(),
}));
const localAnswer = vi.hoisted(() => ({
  tryOnDeviceSemanticAnswer: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => auth);
vi.mock("./assistant-offline-cache", () => cache);
vi.mock("./on-device-ai-answer", () => localAnswer);

import { askBookingAssistant } from "./assistant-api";

const contextRef = {
  kind: "organization" as const,
  recordId: "10000000-0000-4000-8000-000000000001",
  label: "County Fair",
};

function cachedSnapshot() {
  return {
    key: "owner:organization:org-1",
    actorId: "owner",
    kind: "organization" as const,
    recordId: "org-1",
    label: "County Fair",
    savedAt: "2026-08-25T12:00:00Z",
    brief: {
      headline: "County Fair",
      generatedAt: "2026-08-25T12:00:00Z",
      items: [
        {
          key: "contact",
          text: "Primary contact is Amy Smith at 555-0100.",
          confidence: "high" as const,
          sourceIds: ["src-contact"],
        },
      ],
    },
    context: {
      context: { kind: "organization" as const, recordId: "org-1", label: "County Fair" },
      sources: [
        { id: "src-contact", kind: "contact", recordId: "contact-1", label: "Amy Smith", occurredAt: null },
      ],
      generatedAt: "2026-08-25T12:00:00Z",
    },
  };
}

function cloudResponse() {
  return {
    answer: {
      text: "Cloud answer",
      mode: "cloud" as const,
      confidence: "high" as const,
      sources: [],
      needsAdmin: false,
    },
    brief: cachedSnapshot().brief,
    context: cachedSnapshot().context,
    conversationId: "conversation-1",
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

describe("askBookingAssistant on-device routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    cache.getAssistantSnapshot.mockResolvedValue(cachedSnapshot());
    cache.saveAssistantSnapshot.mockResolvedValue(undefined);
    localAnswer.tryOnDeviceSemanticAnswer.mockResolvedValue(null);
    auth.apiPost.mockResolvedValue(cloudResponse());
  });

  it("uses an exact cached answer before calling cloud", async () => {
    const result = await askBookingAssistant({
      context: contextRef,
      question: "Who is the primary contact?",
    });

    expect(result.answer.text).toContain("Amy Smith");
    expect(result.answer.mode).toBe("deterministic");
    expect(auth.apiPost).not.toHaveBeenCalled();
    expect(localAnswer.tryOnDeviceSemanticAnswer).not.toHaveBeenCalled();
  });

  it("returns a strong on-device answer without calling the paid endpoint", async () => {
    localAnswer.tryOnDeviceSemanticAnswer.mockResolvedValue({
      text: "I found this in saved context: power requirements were discussed.",
      mode: "on_device",
      confidence: "high",
      sources: [],
      needsAdmin: false,
    });

    const result = await askBookingAssistant({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("on_device");
    expect(auth.apiPost).not.toHaveBeenCalled();
  });

  it("falls through to cloud when semantic matching is weak", async () => {
    localAnswer.tryOnDeviceSemanticAnswer.mockResolvedValue(null);
    const result = await askBookingAssistant({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("cloud");
    expect(auth.apiPost).toHaveBeenCalledTimes(1);
  });

  it("falls through to cloud when the local layer itself errors", async () => {
    localAnswer.tryOnDeviceSemanticAnswer.mockRejectedValue(new Error("local runtime failed"));
    const result = await askBookingAssistant({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("cloud");
    expect(auth.apiPost).toHaveBeenCalledTimes(1);
  });

  it("does not call cloud while offline after a weak semantic match", async () => {
    setOnline(false);
    localAnswer.tryOnDeviceSemanticAnswer.mockResolvedValue(null);

    const result = await askBookingAssistant({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("offline_cached");
    expect(result.answer.confidence).toBe("low");
    expect(result.answer.text).toMatch(/couldn't find|saved booking brief|live connection/i);
    expect(auth.apiPost).not.toHaveBeenCalled();
  });
});
