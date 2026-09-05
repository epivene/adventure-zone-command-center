import { describe, expect, it } from "vitest";
import {
  EMAIL_DOCUMENT_VERSION,
  createDefaultEmailDocument,
  normalizeEmailDocument,
  serializeEmailDocument,
  shouldAcknowledgeSave,
} from "./email-model";

describe("structured email document model", () => {
  it("normalizes missing and legacy plain-text content safely", () => {
    expect(normalizeEmailDocument(undefined).version).toBe(EMAIL_DOCUMENT_VERSION);
    const legacy = normalizeEmailDocument("Hi {{contactName}}, welcome to {{eventName}}.");
    expect(legacy.blocks.find((block) => block.type === "paragraph")?.content)
      .toContain("{{contactName}}");
  });

  it("round trips ordered blocks, smart fields, media references, and brand settings", () => {
    const document = createDefaultEmailDocument();
    document.blocks.reverse();
    document.blocks[0]!.content = "{{senderName}}";
    document.hero = { assetId: "asset-9", src: null, alt: "Rafting", name: "River" };
    document.brandKit.primaryColor = "#123456";

    const normalized = normalizeEmailDocument(serializeEmailDocument(document));
    expect(normalized.blocks[0]!.id).toBe(document.blocks[0]!.id);
    expect(normalized.blocks[0]!.content).toBe("{{senderName}}");
    expect(normalized.hero.assetId).toBe("asset-9");
    expect(normalized.brandKit.primaryColor).toBe("#123456");
  });

  it("does not acknowledge an older save after a newer edit", () => {
    expect(shouldAcknowledgeSave(4, 5)).toBe(false);
    expect(shouldAcknowledgeSave(5, 5)).toBe(true);
  });
});