import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  embedLocalTexts: vi.fn(),
  isOnDeviceAiEnabled: vi.fn(),
}));

vi.mock("./on-device-ai-runtime", () => runtime);

import type { AssistantCachedSnapshot } from "./assistant-offline-cache";
import { tryOnDeviceSemanticAnswer } from "./on-device-ai-answer";

function snapshot(): AssistantCachedSnapshot {
  return {
    key: "owner:organization:org-1",
    actorId: "owner",
    kind: "organization",
    recordId: "org-1",
    label: "County Fair",
    savedAt: "2026-08-25T12:00:00Z",
    brief: {
      headline: "County Fair",
      generatedAt: "2026-08-25T12:00:00Z",
      items: [
        {
          key: "objection_or_promise",
          text: "They asked whether we can provide enough power without a generator.",
          confidence: "high",
          sourceIds: ["src-power"],
        },
        {
          key: "follow_up",
          text: "Call after the board meeting.",
          confidence: "high",
          sourceIds: ["src-follow"],
        },
      ],
    },
    context: {
      context: { kind: "organization", recordId: "org-1", label: "County Fair" },
      sources: [
        { id: "src-power", kind: "activity", recordId: "a1", label: "Power note", occurredAt: null },
        { id: "src-follow", kind: "follow_up", recordId: "f1", label: "Follow-up", occurredAt: null },
      ],
      generatedAt: "2026-08-25T12:00:00Z",
    },
  };
}

describe("tryOnDeviceSemanticAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.isOnDeviceAiEnabled.mockReturnValue(true);
  });

  it("returns a grounded on-device answer for a strong semantic match", async () => {
    runtime.embedLocalTexts.mockResolvedValue([
      [1, 0],
      [1, 0],
      [0, 1],
      [0.9, 0.1],
      [0, 1],
    ]);

    const answer = await tryOnDeviceSemanticAnswer(
      "Did they ever mention power?",
      snapshot(),
    );

    expect(answer).toMatchObject({
      mode: "on_device",
      confidence: "high",
      needsAdmin: false,
    });
    expect(answer?.text).toContain("provide enough power");
    expect(answer?.sources.map((source) => source.id)).toContain("src-power");
  });

  it("returns null when local AI is disabled", async () => {
    runtime.isOnDeviceAiEnabled.mockReturnValue(false);
    expect(await tryOnDeviceSemanticAnswer("Did they mention power?", snapshot())).toBeNull();
    expect(runtime.embedLocalTexts).not.toHaveBeenCalled();
  });

  it("returns null for a non-semantic cloud question", async () => {
    expect(await tryOnDeviceSemanticAnswer("Draft an email to them", snapshot())).toBeNull();
    expect(runtime.embedLocalTexts).not.toHaveBeenCalled();
  });

  it("falls through when the strongest similarity is below the threshold", async () => {
    runtime.embedLocalTexts.mockResolvedValue([
      [1, 0],
      [0.4, 0.916515],
      [0, 1],
      [0.2, 0.9799],
      [0, 1],
    ]);
    expect(await tryOnDeviceSemanticAnswer("Did they mention power?", snapshot())).toBeNull();
  });

  it("contains runtime failures instead of breaking normal assistant fallback", async () => {
    runtime.embedLocalTexts.mockRejectedValue(new Error("model unavailable"));
    await expect(tryOnDeviceSemanticAnswer("Did they mention power?", snapshot())).resolves.toBeNull();
  });
});
