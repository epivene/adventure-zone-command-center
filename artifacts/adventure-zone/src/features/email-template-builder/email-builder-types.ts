import type { EmailBuilderBlock, EmailBuilderDocument } from "@workspace/api-zod";

export type EmailBlockType = EmailBuilderBlock["type"];

export const adventureZoneBrand = {
  navy: "#0f1729",
  pink: "#ff0a8a",
  yellow: "#ffca05",
  cream: "#f8f6f1",
  white: "#ffffff",
  body: "#26324a",
} as const;

export const emailBlockLabels: Record<EmailBlockType, string> = {
  logoHeader: "Logo header",
  hero: "Hero banner",
  text: "Text",
  image: "Image",
  videoThumbnail: "Video thumbnail",
  packageCards: "Package cards",
  offerCallout: "Offer callout",
  buttonRow: "Buttons",
  divider: "Divider",
  spacer: "Spacer",
  signature: "Signature",
  footer: "Footer",
  customHtml: "Custom HTML",
};

export const adventureZoneAssets = {
  logo: "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-logo-navy.png",
  miniTrailer: "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-mini-trailer.gif",
  pirates: "https://adventure-zone-command-center-1.onrender.com/assets/pirates-rebellion-paddle-boats.jpg",
  adventure: "https://static.wixstatic.com/media/0e6e2c_d18d32eac9704b44a2dc9a1c28f9158b~mv2.jpg",
  warriors: "https://static.wixstatic.com/media/0e6e2c_a25608d697b146ac981ab5b6f074664c~mv2.jpg",
} as const;

function blockId(type: EmailBlockType): string {
  return `${type}-${globalThis.crypto.randomUUID()}`;
}

export function createEmailBlock(type: EmailBlockType, id = blockId(type)): EmailBuilderBlock {
  const base = { id };
  switch (type) {
    case "logoHeader": return { ...base, type, imageUrl: adventureZoneAssets.logo, altText: "The Adventure Zone", width: 390, align: "center", backgroundColor: adventureZoneBrand.navy, padding: 20 };
    case "hero": return { ...base, type, eyebrow: "YOUR NEXT ADVENTURE", headline: "LET'S BRING", highlightedText: "THE FUN.", supportingText: "Professional, fully staffed bounce house carnival fun for your community.", backgroundColor: adventureZoneBrand.navy, textColor: adventureZoneBrand.white, accentColor: adventureZoneBrand.pink, highlightColor: adventureZoneBrand.yellow, padding: 38 };
    case "text": return { ...base, type, content: "Hi {{contactName}},\n\nWrite your message here.", contentFormat: "plain", backgroundColor: adventureZoneBrand.cream, textColor: adventureZoneBrand.body, align: "left", padding: 38 };
    case "image": return { ...base, type, imageUrl: adventureZoneAssets.miniTrailer, altText: "The Adventure Zone", linkUrl: "https://www.the-adventure-zone.com/", width: 612, height: 0, borderColor: adventureZoneBrand.navy, backgroundColor: adventureZoneBrand.cream, padding: 14 };
    case "videoThumbnail": return { ...base, type, imageUrl: adventureZoneAssets.miniTrailer, altText: "The Adventure Zone — tap to learn more", linkUrl: "https://www.the-adventure-zone.com/adventure-zone", label: "Tap to learn more!", backgroundColor: adventureZoneBrand.cream, borderColor: adventureZoneBrand.navy, padding: 14 };
    case "packageCards": return { ...base, type, cards: [
      { imageUrl: adventureZoneAssets.pirates, altText: "Pirate's Rebellion", label: "PIRATE'S\nREBELLION", linkUrl: "https://www.the-adventure-zone.com/pirates-rebellion" },
      { imageUrl: adventureZoneAssets.adventure, altText: "Adventure Zone", label: "ADVENTURE\nZONE", linkUrl: "https://www.the-adventure-zone.com/adventure-zone" },
      { imageUrl: adventureZoneAssets.warriors, altText: "Warrior's Playground", label: "WARRIOR'S\nPLAYGROUND", linkUrl: "https://www.the-adventure-zone.com/warriors-playground" },
    ], backgroundColor: adventureZoneBrand.cream, cardColor: adventureZoneBrand.pink, textColor: adventureZoneBrand.white, accentColor: adventureZoneBrand.white, padding: 14 };
    case "offerCallout": return { ...base, type, eyebrow: "EARLY BIRD", title: "Make your next event unforgettable", description: "Reply to learn more about our current offer.", backgroundColor: "#fff4f8", textColor: adventureZoneBrand.navy, accentColor: adventureZoneBrand.pink, padding: 20 };
    case "buttonRow": return { ...base, type, buttons: [{ label: "CONTACT US", url: "mailto:TheAdventureZone12@gmail.com" }, { label: "EXPLORE THE WEBSITE", url: "https://www.the-adventure-zone.com/" }], backgroundColor: adventureZoneBrand.yellow, buttonColor: adventureZoneBrand.navy, textColor: adventureZoneBrand.white, align: "center", padding: 28 };
    case "divider": return { ...base, type, color: adventureZoneBrand.pink, backgroundColor: adventureZoneBrand.cream, thickness: 4, padding: 12 };
    case "spacer": return { ...base, type, backgroundColor: adventureZoneBrand.cream, height: 24 };
    case "signature": return { ...base, type, closing: "Looking forward to what comes next!\n\n{{senderName}}", backgroundColor: adventureZoneBrand.cream, textColor: adventureZoneBrand.body, padding: 38 };
    case "footer": return { ...base, type, businessName: "The Adventure Zone", tagline: "America's Best Bounce House Carnival!", email: "TheAdventureZone12@gmail.com", phone: "435-760-5583", websiteUrl: "https://www.the-adventure-zone.com/", backgroundColor: adventureZoneBrand.navy, textColor: adventureZoneBrand.white, accentColor: adventureZoneBrand.pink, padding: 25 };
    case "customHtml": return { ...base, type, html: "<tr><td>Add preserved email HTML here.</td></tr>" };
  }
}

export function createBrandedStarterDocument(): EmailBuilderDocument {
  return {
    version: 1,
    settings: { backgroundColor: adventureZoneBrand.cream, contentWidth: 640, preheader: "A note from The Adventure Zone" },
    blocks: ["logoHeader", "hero", "text", "videoThumbnail", "packageCards", "offerCallout", "buttonRow", "signature", "footer"].map((type) => createEmailBlock(type as EmailBlockType)),
  };
}

export function createBlankEmailDocument(): EmailBuilderDocument {
  return { version: 1, settings: { backgroundColor: adventureZoneBrand.cream, contentWidth: 640 }, blocks: [createEmailBlock("text")] };
}
