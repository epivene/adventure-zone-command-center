import { describe, expect, it } from "vitest";
import { compileEmailBuilderDocument, emailBuilderDocumentSchema, type EmailBuilderDocument } from "@workspace/api-zod";

import { templateFingerprint } from "@/features/boss-work-requests/boss-work-request-service";
import { renderCommunicationTemplateText } from "./communication-template-renderer";

const brandedDocument: EmailBuilderDocument = {
  version: 1,
  settings: { backgroundColor: "#f8f6f1", contentWidth: 640, preheader: "A note from The Adventure Zone" },
  blocks: [
    { id: "logo", type: "logoHeader", imageUrl: "https://example.com/adventure-zone-logo.png", altText: "The Adventure Zone", width: 390, align: "center", backgroundColor: "#0f1729", padding: 20 },
    { id: "hero", type: "hero", eyebrow: "YOUR NEXT ADVENTURE", headline: "LET'S BRING", highlightedText: "THE FUN.", supportingText: "Professional, fully staffed bounce house carnival fun.", backgroundColor: "#0f1729", textColor: "#ffffff", accentColor: "#ff0a8a", highlightColor: "#ffca05", padding: 38 },
    { id: "text", type: "text", content: "Hi {{contactName}},\n\nWrite your message here.", backgroundColor: "#f8f6f1", textColor: "#26324a", align: "left", padding: 38 },
    { id: "video", type: "videoThumbnail", imageUrl: "https://example.com/trailer.jpg", altText: "The Adventure Zone — tap to learn more", linkUrl: "https://www.the-adventure-zone.com/adventure-zone", label: "Tap to learn more!", backgroundColor: "#f8f6f1", borderColor: "#0f1729", padding: 14 },
    { id: "cards", type: "packageCards", cards: [
      { imageUrl: "https://example.com/pirates.jpg", altText: "Pirate's Rebellion", label: "PIRATE'S REBELLION", linkUrl: "https://www.the-adventure-zone.com/pirates-rebellion" },
      { imageUrl: "https://example.com/adventure.jpg", altText: "Adventure Zone", label: "ADVENTURE ZONE", linkUrl: "https://www.the-adventure-zone.com/adventure-zone" },
      { imageUrl: "https://example.com/warriors.jpg", altText: "Warrior's Playground", label: "WARRIOR'S PLAYGROUND", linkUrl: "https://www.the-adventure-zone.com/warriors-playground" },
    ], backgroundColor: "#f8f6f1", cardColor: "#ff0a8a", textColor: "#ffffff", accentColor: "#ffffff", padding: 14 },
    { id: "offer", type: "offerCallout", eyebrow: "EARLY BIRD", title: "Make your next event unforgettable", description: "Reply to learn more about our current offer.", backgroundColor: "#fff4f8", textColor: "#0f1729", accentColor: "#ff0a8a", padding: 20 },
    { id: "buttons", type: "buttonRow", buttons: [{ label: "CONTACT US", url: "mailto:TheAdventureZone12@gmail.com" }, { label: "EXPLORE THE WEBSITE", url: "https://www.the-adventure-zone.com/" }], backgroundColor: "#ffca05", buttonColor: "#0f1729", textColor: "#ffffff", align: "center", padding: 28 },
    { id: "signature", type: "signature", closing: "Looking forward to what comes next!\n\n{{senderName}}", backgroundColor: "#f8f6f1", textColor: "#26324a", padding: 38 },
    { id: "footer", type: "footer", businessName: "The Adventure Zone", tagline: "America's Best Bounce House Carnival!", email: "TheAdventureZone12@gmail.com", phone: "435-760-5583", websiteUrl: "https://www.the-adventure-zone.com/", backgroundColor: "#0f1729", textColor: "#ffffff", accentColor: "#ff0a8a", padding: 25 },
  ],
};

describe("visual email builder acceptance", () => {
  it("produces a complete responsive Adventure Zone email compatible with existing delivery flows", () => {
    const document = emailBuilderDocumentSchema.parse(brandedDocument);
    const html = compileEmailBuilderDocument(document);
    const blockTypes = document.blocks.map((block) => block.type);

    expect(blockTypes).toEqual(expect.arrayContaining([
      "logoHeader", "hero", "text", "videoThumbnail", "packageCards",
      "offerCallout", "buttonRow", "signature", "footer",
    ]));
    expect(html).toContain('width="640"');
    expect(html).toContain("#0f1729");
    expect(html).toContain("#ff0a8a");
    expect(html).toContain("#ffca05");
    expect(html).toContain("#f8f6f1");
    expect(html).toContain(".az-stack,.az-stack&gt;td".replace("&gt;", ">"));
    expect(html).toContain('alt="The Adventure Zone"');
    expect(html).toContain('alt="Pirate&#39;s Rebellion"');
    expect(html).toContain('href="https://www.the-adventure-zone.com/"');
    expect(html).toContain("margin:0 auto");
    expect(html).toMatch(/href="https:\/\/www\.the-adventure-zone\.com\/"[^>]+color:#ffffff!important/);
    expect(html).not.toMatch(/<script|<form|<iframe|<svg|javascript:|\son[a-z]+=/i);

    const rendered = renderCommunicationTemplateText({
      templateId: "visual-builder-acceptance",
      subjectTemplate: "A note for {{contactName}}",
      bodyTemplate: html,
      bodyFormat: "html",
      requiredPlaceholders: ["contactName"],
      values: { contactName: "Taylor", senderName: "Desiree" },
    });

    expect(rendered.subject).toBe("A note for Taylor");
    expect(rendered.body).toContain("Hi Taylor,");
    expect(rendered.body).toContain("Desiree");
    expect(rendered.body).toContain("@media only screen and (max-width:680px)");
    expect(rendered.body).toContain(".az-stack");
    expect(rendered.bodyFormat).toBe("html");
    expect(rendered.missingRequiredFields).toEqual([]);

    const fingerprintInput = {
      templateVersion: "builder-v1",
      subjectTemplate: "A note for {{contactName}}",
      bodyTemplate: html,
      bodyFormat: "html" as const,
    };
    expect(templateFingerprint(fingerprintInput)).toMatch(/^[a-f0-9]{64}$/);
    expect(templateFingerprint(fingerprintInput)).toBe(templateFingerprint(fingerprintInput));
  });
});
