import { describe, expect, it, vi } from "vitest";

import type { DesignEmailDocument } from "@workspace/api-zod/design-studio-email";
import {
  fingerprintDesignEmailHtml,
  freezeDesignEmailVersion,
  parseDesignEmailDocument,
  renderDesignEmailHtml,
  type DesignEmailFreezeStore,
} from "./design-email-renderer";

function createDefaultEmailDocument(): DesignEmailDocument {
  return {
    version: 1,
    kind: "branded-email",
    blocks: [
      {
        id: "header",
        type: "header",
        label: "Header",
        content: "ADVENTURE ZONE",
        link: "",
        showOnMobile: true,
      },
      {
        id: "hero",
        type: "hero",
        label: "Hero",
        content: "",
        link: "",
        showOnMobile: true,
      },
      {
        id: "heading",
        type: "heading",
        label: "Heading",
        content: "Hello",
        link: "",
        showOnMobile: true,
      },
      {
        id: "paragraph",
        type: "paragraph",
        label: "Body",
        content: "Welcome",
        link: "",
        showOnMobile: true,
      },
      {
        id: "button",
        type: "button",
        label: "Button",
        content: "Learn more",
        link: "https://example.test",
        showOnMobile: true,
      },
      {
        id: "footer",
        type: "footer",
        label: "Footer",
        content: "Adventure Zone",
        link: "",
        showOnMobile: true,
      },
    ],
    hero: { assetId: null, src: null, alt: "Adventure Zone", name: "Hero" },
    brandKit: {
      name: "Adventure Zone",
      primaryColor: "#e85d35",
      accentColor: "#efb33f",
      textColor: "#182225",
      backgroundColor: "#f6f2e9",
      typography: "Arial",
      highContrastButtons: true,
    },
  };
}

describe("Design Studio email rendering", () => {
  it("renders deterministic mobile-safe HTML and escapes authored text", () => {
    const document = createDefaultEmailDocument();
    document.hero.src = "https://assets.example.test/hero.png";
    document.blocks.find((block) => block.type === "heading")!.content =
      '<script>alert("no")</script> Great & useful';

    const first = renderDesignEmailHtml(document);
    const second = renderDesignEmailHtml(document);

    expect(first).toContain("<!doctype html>");
    expect(first).toContain("max-width:600px");
    expect(first).toContain("&lt;script&gt;");
    expect(first).not.toContain("<script>alert");
    expect(first).toContain("https://assets.example.test/hero.png");
    expect(fingerprintDesignEmailHtml(first)).toBe(
      fingerprintDesignEmailHtml(second),
    );
  });

  it("drops unsafe external targets and rejects unknown blocks", () => {
    const document = createDefaultEmailDocument();
    document.hero.src = "javascript:alert(1)";
    document.blocks.find((block) => block.type === "button")!.link =
      "http://example.test";
    const html = renderDesignEmailHtml(document);

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("http://example.test");

    const unknown = JSON.stringify({
      ...document,
      blocks: [{ ...document.blocks[0], type: "script" }],
    });
    expect(() => parseDesignEmailDocument(unknown)).toThrow(
      "DESIGN_EMAIL_INVALID_DOCUMENT",
    );
  });

  it("freezes the exact owned linked project content in one transaction", async () => {
    const document = createDefaultEmailDocument();
    const content = JSON.stringify(document);
    const insertImmutableVersion = vi
      .fn()
      .mockResolvedValue({ id: "version-1" });
    const transaction = vi.fn(async (callback) =>
      callback({
        loadOwnedEmailProject: vi.fn().mockResolvedValue({
          id: "project-1",
          content,
          linkedOrganizationId: "organization-1",
          linkedContactId: "contact-1",
        }),
        insertImmutableVersion,
      }),
    );
    const store = { transaction } as unknown as DesignEmailFreezeStore;

    const first = await freezeDesignEmailVersion(
      { projectId: "project-1", accountId: "account-1" },
      store,
    );
    const second = await freezeDesignEmailVersion(
      { projectId: "project-1", accountId: "account-1" },
      store,
    );

    expect(first.versionId).toBe("version-1");
    expect(first.htmlFingerprint).toBe(second.htmlFingerprint);
    expect(insertImmutableVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ content }),
      }),
    );
  });

  it("refuses an unlinked project before creating a version", async () => {
    const insertImmutableVersion = vi.fn();
    const store: DesignEmailFreezeStore = {
      transaction: async (callback) =>
        callback({
          loadOwnedEmailProject: async () => ({
            id: "project-1",
            content: JSON.stringify(createDefaultEmailDocument()),
            linkedOrganizationId: null,
            linkedContactId: null,
          }),
          insertImmutableVersion,
        }),
    };

    await expect(
      freezeDesignEmailVersion(
        { projectId: "project-1", accountId: "account-1" },
        store,
      ),
    ).rejects.toThrow("DESIGN_EMAIL_PROFILE_LINK_REQUIRED");
    expect(insertImmutableVersion).not.toHaveBeenCalled();
  });
});
