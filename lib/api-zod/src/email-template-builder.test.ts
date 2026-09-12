import { describe, expect, it } from "vitest";

import {
  EMAIL_BUILDER_DOCUMENT_VERSION,
  emailBuilderDocumentSchema,
} from "./email-template-builder";

const textBlock = {
  id: "block-text-1",
  type: "text" as const,
  content: "Hi {{contactName}}",
  backgroundColor: "#f8f6f1",
  textColor: "#26324a",
  align: "left" as const,
  padding: 32,
};

describe("emailBuilderDocumentSchema", () => {
  it("accepts a branded version-one document", () => {
    const parsed = emailBuilderDocumentSchema.parse({
      version: 1,
      settings: {
        backgroundColor: "#f8f6f1",
        contentWidth: 640,
        preheader: "A note for {{eventName}}",
      },
      blocks: [
        {
          id: "block-hero-1",
          type: "hero",
          eyebrow: "LET'S MAKE MEMORIES",
          headline: "BRING THE FUN BACK.",
          highlightedText: "THE ADVENTURE ZONE",
          supportingText: "A fully staffed bounce house carnival.",
          backgroundColor: "#0f1729",
          textColor: "#ffffff",
          accentColor: "#ff0a8a",
          highlightColor: "#ffca05",
          padding: 38,
        },
        textBlock,
      ],
    });

    expect(parsed.version).toBe(EMAIL_BUILDER_DOCUMENT_VERSION);
    expect(parsed.blocks).toHaveLength(2);
  });

  it("rejects unsafe link schemes", () => {
    const result = emailBuilderDocumentSchema.safeParse({
      version: 1,
      settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
      blocks: [{
        id: "block-button-1",
        type: "buttonRow",
        buttons: [{ label: "Bad link", url: "javascript:alert(1)" }],
        backgroundColor: "#f8f6f1",
        buttonColor: "#0f1729",
        textColor: "#ffffff",
        align: "center",
        padding: 24,
      }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects placeholder-driven destinations with an unknown final protocol", () => {
    const result = emailBuilderDocumentSchema.safeParse({
      version: 1,
      settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
      blocks: [{
        id: "block-button-1",
        type: "buttonRow",
        buttons: [{ label: "Unknown destination", url: "{{additionalInsuredInfo}}" }],
        backgroundColor: "#f8f6f1",
        buttonColor: "#0f1729",
        textColor: "#ffffff",
        align: "center",
        padding: 24,
      }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects documents above the block limit", () => {
    const result = emailBuilderDocumentSchema.safeParse({
      version: 1,
      settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
      blocks: Array.from({ length: 101 }, (_, index) => ({
        ...textBlock,
        id: `block-text-${index}`,
      })),
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate block IDs", () => {
    const result = emailBuilderDocumentSchema.safeParse({
      version: 1,
      settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
      blocks: [textBlock, { ...textBlock }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown block types", () => {
    const result = emailBuilderDocumentSchema.safeParse({
      version: 1,
      settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
      blocks: [{ id: "block-bad-1", type: "carousel", content: "No" }],
    });

    expect(result.success).toBe(false);
  });
});
