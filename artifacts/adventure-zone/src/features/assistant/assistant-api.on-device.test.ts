// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  getAssistantSnapshot: vi.fn(),
}));
const localAnswer = vi.hoisted(() => ({
  tryOnDeviceSemanticAnswer: vi.fn(),
}));
const cloud = vi.hoisted(() => ({
  askBookingAssistant: vi.fn(),
}));

vi.mock("./assistant-offline-cache", () => cache);
vi.mock("./on-device-ai-answer", () => localAnswer);
vi.mock("./assistant-api", () => cloud);

import { askBookingAssistantLocalFirst } from "./on-device-ai-assistant";

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
    savedAt: new Date().toISOString(),
    brief: {
      headline: "County Fair",
      generatedAt: new Date().toISOString(),
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
      generatedAt: new Date().toISOString(),
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

describe("local-first booking assistant routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
    cache.getAssistantSnapshot.mockResolvedValue(cachedSnapshot());
    localAnswer.tryOnDeviceSemanticAnswer.mockResolvedValue(null);
    cloud.askBookingAssistant.mockResolvedValue(cloudResponse());
  });

  it("uses an exact cached answer before calling cloud", async () => {
    const result = await askBookingAssistantLocalFirst({
      context: contextRef,
      question: "Who is the primary contact?",
    });

    expect(result.answer.text).toContain("Amy Smith");
    expect(result.answer.mode).toBe("deterministic");
    expect(cloud.askBookingAssistant).not.toHaveBeenCalled();
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

    const result = await askBookingAssistantLocalFirst({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("on_device");
    expect(cloud.askBookingAssistant).not.toHaveBeenCalled();
  });

  it("falls through to cloud when semantic matching is weak", async () => {
    localAnswer.tryOnDeviceSemanticAnswer.mockResolvedValue(null);
    const result = await askBookingAssistantLocalFirst({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("cloud");
    expect(cloud.askBookingAssistant).toHaveBeenCalledTimes(1);
  });

  it("falls through to cloud when the local layer itself errors", async () => {
    localAnswer.tryOnDeviceSemanticAnswer.mockRejectedValue(new Error("local runtime failed"));
    const result = await askBookingAssistantLocalFirst({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("cloud");
    expect(cloud.askBookingAssistant).toHaveBeenCalledTimes(1);
  });

  it("uses live cloud data online when the cached profile is older than 24 hours", async () => {
    cache.getAssistantSnapshot.mockResolvedValue({
      ...cachedSnapshot(),
      savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    const result = await askBookingAssistantLocalFirst({
      context: contextRef,
      question: "Who is the primary contact?",
    });

    expect(result.answer.mode).toBe("cloud");
    expect(localAnswer.tryOnDeviceSemanticAnswer).not.toHaveBeenCalled();
    expect(cloud.askBookingAssistant).toHaveBeenCalledTimes(1);
  });

  it("does not call cloud while offline after a weak semantic match", async () => {
    setOnline(false);
    localAnswer.tryOnDeviceSemanticAnswer.mockResolvedValue(null);

    const result = await askBookingAssistantLocalFirst({
      context: contextRef,
      question: "Did they ever mention power?",
    });

    expect(result.answer.mode).toBe("offline_cached");
    expect(result.answer.confidence).toBe("low");
    expect(result.answer.text).toMatch(/couldn't find|live connection/i);
    expect(cloud.askBookingAssistant).not.toHaveBeenCalled();
  });
});
