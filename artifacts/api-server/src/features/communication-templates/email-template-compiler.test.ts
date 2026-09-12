import { describe, expect, it } from "vitest";
import type { EmailBuilderDocument } from "@workspace/api-zod";

import {
  compileEmailBuilderDocument,
  sanitizeCustomEmailHtml,
} from "./email-template-compiler";

const document: EmailBuilderDocument = {
  version: 1,
  settings: {
    backgroundColor: "#f8f6f1",
    contentWidth: 640,
    preheader: "A new note for {{eventName}}",
  },
  blocks: [
    {
      id: "logo",
      type: "logoHeader",
      imageUrl: "https://example.com/logo.png",
      altText: "The Adventure Zone",
      width: 390,
      align: "center",
      backgroundColor: "#0f1729",
      padding: 20,
    },
    {
      id: "hero",
      type: "hero",
      eyebrow: "LET'S MAKE MEMORIES",
      headline: "BRING THE FUN BACK.",
      highlightedText: "AMERICA'S BEST BOUNCE HOUSE CARNIVAL!",
      supportingText: "Professional, fully staffed fun for {{eventName}}.",
      backgroundColor: "#0f1729",
      textColor: "#ffffff",
      accentColor: "#ff0a8a",
      highlightColor: "#ffca05",
      padding: 38,
    },
    {
      id: "text",
      type: "text",
      content: "Hi {{contactName}},\n\nWe would love to return.",
      backgroundColor: "#f8f6f1",
      textColor: "#26324a",
      align: "left",
      padding: 38,
    },
    {
      id: "video",
      type: "videoThumbnail",
      imageUrl: "https://example.com/video.jpg",
      altText: "Warrior's Playground — tap to learn more",
      linkUrl: "https://www.the-adventure-zone.com/warriors-playground",
      label: "Tap to learn more!",
      backgroundColor: "#f8f6f1",
      borderColor: "#0f1729",
      padding: 14,
    },
    {
      id: "cards",
      type: "packageCards",
      cards: [
        { imageUrl: "https://example.com/pirates.jpg", altText: "Pirate's Rebellion", label: "PIRATE'S REBELLION", linkUrl: "https://www.the-adventure-zone.com/pirates-rebellion" },
        { imageUrl: "https://example.com/adventure.jpg", altText: "Adventure Zone", label: "ADVENTURE ZONE", linkUrl: "https://www.the-adventure-zone.com/adventure-zone" },
        { imageUrl: "https://example.com/warriors.jpg", altText: "Warrior's Playground", label: "WARRIOR'S PLAYGROUND", linkUrl: "https://www.the-adventure-zone.com/warriors-playground" },
      ],
      backgroundColor: "#f8f6f1",
      cardColor: "#ff0a8a",
      textColor: "#ffffff",
      accentColor: "#ffffff",
      padding: 14,
    },
    {
      id: "offer",
      type: "offerCallout",
      eyebrow: "EARLY BIRD",
      title: "Save 10% on your next event",
      description: "Reply to learn more.",
      backgroundColor: "#fff4f8",
      textColor: "#0f1729",
      accentColor: "#ff0a8a",
      padding: 20,
    },
    {
      id: "buttons",
      type: "buttonRow",
      buttons: [
        { label: "CONTACT US", url: "mailto:TheAdventureZone12@gmail.com" },
        { label: "EXPLORE THE WEBSITE", url: "https://www.the-adventure-zone.com/" },
      ],
      backgroundColor: "#ffca05",
      buttonColor: "#0f1729",
      textColor: "#ffffff",
      align: "center",
      padding: 28,
    },
    {
      id: "footer",
      type: "footer",
      businessName: "The Adventure Zone",
      tagline: "America's Best Bounce House Carnival!",
      email: "TheAdventureZone12@gmail.com",
      phone: "435-760-5583",
      websiteUrl: "https://www.the-adventure-zone.com/",
      backgroundColor: "#0f1729",
      textColor: "#ffffff",
      accentColor: "#ff0a8a",
      padding: 25,
    },
  ],
};

describe("compileEmailBuilderDocument", () => {
  it("compiles the branded document into responsive presentation-table HTML", () => {
    const html = compileEmailBuilderDocument(document);

    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('width="640"');
    expect(html).toContain("#0f1729");
    expect(html).toContain("#ff0a8a");
    expect(html).toContain("#ffca05");
    expect(html).toContain("{{contactName}}");
    expect(html).toContain("{{eventName}}");
    expect(html).toContain("az-stack");
    expect(html).toContain("Warrior&#39;s Playground — tap to learn more");
    expect(html).toContain("EXPLORE THE WEBSITE");
    expect(html).not.toMatch(/<script|javascript:|onclick=/i);
  });

  it("produces byte-identical output for the same document", () => {
    expect(compileEmailBuilderDocument(document)).toBe(compileEmailBuilderDocument(document));
  });

  it("retains a legacy row byte-for-byte until that block is edited", () => {
    const sourceHtml = '<tr data-legacy="yes"><td><strong>Original {{contactName}}</strong></td></tr>';
    const withLegacySource: EmailBuilderDocument = {
      ...document,
      blocks: [{ ...document.blocks[2]!, sourceHtml }],
    };
    expect(compileEmailBuilderDocument(withLegacySource)).toContain(sourceHtml);
  });

  it("supports constrained rich text without active markup", () => {
    const richDocument: EmailBuilderDocument = {
      ...document,
      blocks: [{
        id: "rich-text",
        type: "text",
        content: '<h2>Welcome</h2><p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com">link</a><img src=x onerror=alert(1)></p>',
        contentFormat: "rich_text",
        backgroundColor: "#f8f6f1",
        textColor: "#26324a",
        align: "left",
        padding: 38,
      }],
    };
    const html = compileEmailBuilderDocument(richDocument);
    expect(html).toContain("<h2>Welcome</h2>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toMatch(/<img|onerror=/i);
  });
});

describe("sanitizeCustomEmailHtml", () => {
  it("preserves useful email tables while removing active content", () => {
    const sanitized = sanitizeCustomEmailHtml(`
      <table role="presentation"><tr><td style="color:#0f1729;background-image:url(javascript:alert(1))">
        <a href="javascript:alert(1)" onclick="alert(1)">Unsafe</a>
        <a href="https://example.com">Safe</a><script>alert(1)</script><form><input></form><svg></svg>
      </td></tr></table>
    `);

    expect(sanitized).toContain('<table role="presentation">');
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).not.toMatch(/script|javascript:|onclick|<form|<input|<svg/i);
  });

  it("removes unquoted and entity-obfuscated unsafe destinations", () => {
    const sanitized = sanitizeCustomEmailHtml(`
      <a href=javascript:alert(1)>Unquoted</a>
      <a href="jav&#x61;script:alert(1)">Entity</a>
      <img src='data:text/html;base64,PHNjcmlwdD4=' alt="Unsafe">
      <img src='data:image/svg+xml;base64,PHN2Zz4=' alt="Unsafe SVG">
      <a href="https://example.com/path">Safe</a>
    `);

    expect(sanitized).toContain('href="https://example.com/path"');
    expect(sanitized).not.toMatch(/href\s*=\s*(?:["']?javascript|["']?jav&#x61;script)/i);
    expect(sanitized).not.toMatch(/src\s*=\s*["']?data:text\/html/i);
    expect(sanitized).not.toMatch(/src\s*=\s*["']?data:image\/svg/i);
  });
});
