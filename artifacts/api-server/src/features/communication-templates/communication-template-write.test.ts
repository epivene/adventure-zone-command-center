import { describe, expect, it } from "vitest";
import type { EmailBuilderDocument } from "@workspace/api-zod";

import { prepareCommunicationTemplateWrite, shouldClearEditorDocument } from "./communication-template-write";

const visualDocument: EmailBuilderDocument = {
  version: 1,
  settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
  blocks: [{
    id: "hero",
    type: "hero",
    eyebrow: "WELCOME",
    headline: "LET'S BRING THE FUN",
    highlightedText: "{{eventName}}",
    supportingText: "Hi {{contactName}}",
    backgroundColor: "#0f1729",
    textColor: "#ffffff",
    accentColor: "#ff0a8a",
    highlightColor: "#ffca05",
    padding: 38,
  }],
};

describe("prepareCommunicationTemplateWrite", () => {
  it("compiles a visual document instead of trusting submitted body HTML", () => {
    const prepared = prepareCommunicationTemplateWrite({
      bodyTemplate: "CLIENT FORGERY",
      bodyFormat: "plain_text",
      editorDocument: visualDocument,
    });

    expect(prepared.bodyTemplate).toContain("LET&#39;S BRING THE FUN");
    expect(prepared.bodyTemplate).not.toContain("CLIENT FORGERY");
    expect(prepared.bodyFormat).toBe("html");
    expect(prepared.editorDocumentVersion).toBe(1);
  });

  it("preserves legacy body writes when no visual document is supplied", () => {
    expect(prepareCommunicationTemplateWrite({
      bodyTemplate: "Hi {{contactName}}",
      bodyFormat: "plain_text",
    })).toEqual({
      bodyTemplate: "Hi {{contactName}}",
      bodyFormat: "plain_text",
    });
  });

  it("clears a stale visual document when a legacy client replaces the body", () => {
    expect(prepareCommunicationTemplateWrite({
      bodyTemplate: "Legacy client replacement",
      bodyFormat: "plain_text",
      clearEditorDocument: true,
    })).toEqual({
      bodyTemplate: "Legacy client replacement",
      bodyFormat: "plain_text",
      editorDocument: null,
      editorDocumentVersion: null,
    });
  });

  it("clears stale editor state for body-format-only legacy writes but not subject-only writes", () => {
    expect(shouldClearEditorDocument({ bodyFormat: "plain_text" })).toBe(true);
    expect(shouldClearEditorDocument({ bodyTemplate: "Replacement" })).toBe(true);
    expect(shouldClearEditorDocument({ bodyFormat: "html", editorDocument: visualDocument })).toBe(false);
    expect(shouldClearEditorDocument({})).toBe(false);
  });
});
