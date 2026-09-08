import { isStableImageUrl } from "@/lib/design-studio-api";

export const EMAIL_DOCUMENT_VERSION = 1 as const;

export type EmailBlockType =
  | "header"
  | "hero"
  | "heading"
  | "paragraph"
  | "button"
  | "divider"
  | "spacer"
  | "footer";

export type EmailBlock = {
  id: string;
  type: EmailBlockType;
  label: string;
  content: string;
  link: string;
  showOnMobile: boolean;
};

export type EmailMediaReference = {
  assetId: string | null;
  src: string | null;
  alt: string;
  name: string;
};

export type EmailBrandKit = {
  name: string;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  typography: string;
  highContrastButtons: boolean;
};

export type EmailDocument = {
  version: typeof EMAIL_DOCUMENT_VERSION;
  kind: "branded-email";
  blocks: EmailBlock[];
  hero: EmailMediaReference;
  brandKit: EmailBrandKit;
};

const BLOCK_TYPES = new Set<EmailBlockType>([
  "header", "hero", "heading", "paragraph", "button", "divider", "spacer", "footer",
]);

const DEFAULT_BLOCKS: EmailBlock[] = [
  { id: "header", type: "header", label: "Adventure Zone header", content: "ADVENTURE ZONE", link: "", showOnMobile: true },
  { id: "hero", type: "hero", label: "Hero image", content: "Adventure Zone email hero", link: "", showOnMobile: true },
  { id: "heading", type: "heading", label: "Main heading", content: "Your next adventure starts here", link: "", showOnMobile: true },
  { id: "paragraph", type: "paragraph", label: "Intro paragraph", content: "Hi {{contactName}},\n\nBig skies, bold stories, and unforgettable Wyoming moments are waiting. Join us for {{eventName}} on {{eventDates}}.", link: "", showOnMobile: true },
  { id: "button", type: "button", label: "Primary call to action", content: "Plan your visit", link: "https://adventurezone.com/visit", showOnMobile: true },
  { id: "divider", type: "divider", label: "Divider", content: "", link: "", showOnMobile: true },
  { id: "footer", type: "footer", label: "Adventure Zone footer", content: "Adventure Zone · Cody, Wyoming\nManage preferences · Unsubscribe", link: "", showOnMobile: true },
];

export const DEFAULT_EMAIL_HERO = "/assets/gallery-action-arena.jpg";

export function createDefaultEmailDocument(legacyText = ""): EmailDocument {
  const blocks = DEFAULT_BLOCKS.map((block) => ({ ...block }));
  if (legacyText.trim()) {
    const paragraph = blocks.find((block) => block.type === "paragraph");
    if (paragraph) paragraph.content = legacyText;
  }
  return {
    version: EMAIL_DOCUMENT_VERSION,
    kind: "branded-email",
    blocks,
    hero: {
      assetId: null,
      src: DEFAULT_EMAIL_HERO,
      alt: "Adventure Zone email hero",
      name: "Action arena",
    },
    brandKit: {
      name: "Adventure Zone",
      primaryColor: "#ff1791",
      accentColor: "#ffd21c",
      textColor: "#080808",
      backgroundColor: "#fff9f5",
      typography: "DM Sans / Impact display",
      highContrastButtons: true,
    },
  };
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function normalizeEmailDocument(content: string | null | undefined): EmailDocument {
  const fallback = createDefaultEmailDocument();
  if (!content?.trim()) return fallback;

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return createDefaultEmailDocument(content);
  }
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "branded-email") return createDefaultEmailDocument(content);

  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const usedIds = new Set<string>();
  const blocks = rawBlocks.flatMap((entry, index): EmailBlock[] => {
    if (!entry || typeof entry !== "object") return [];
    const block = entry as Record<string, unknown>;
    if (!BLOCK_TYPES.has(block.type as EmailBlockType)) return [];
    const type = block.type as EmailBlockType;
    let id = text(block.id, `${type}-${index + 1}`);
    if (usedIds.has(id)) id = `${id}-${index + 1}`;
    usedIds.add(id);
    const defaultBlock = DEFAULT_BLOCKS.find((candidate) => candidate.type === type);
    return [{
      id,
      type,
      label: text(block.label, defaultBlock?.label ?? `New ${type} block`),
      content: text(block.content, defaultBlock?.content ?? ""),
      link: text(block.link, ""),
      showOnMobile: typeof block.showOnMobile === "boolean" ? block.showOnMobile : true,
    }];
  });

  const rawHero = raw.hero && typeof raw.hero === "object"
    ? raw.hero as Record<string, unknown>
    : {};
  const assetId = typeof rawHero.assetId === "string" ? rawHero.assetId : null;
  const source = typeof rawHero.src === "string" && isStableImageUrl(rawHero.src)
    ? rawHero.src
    : null;
  const rawBrand = raw.brandKit && typeof raw.brandKit === "object"
    ? raw.brandKit as Record<string, unknown>
    : {};

  return {
    version: EMAIL_DOCUMENT_VERSION,
    kind: "branded-email",
    blocks: blocks.length ? blocks : fallback.blocks,
    hero: {
      assetId,
      src: assetId ? null : source ?? fallback.hero.src,
      alt: text(rawHero.alt, fallback.hero.alt),
      name: text(rawHero.name, fallback.hero.name),
    },
    brandKit: {
      name: text(rawBrand.name, fallback.brandKit.name),
      primaryColor: color(rawBrand.primaryColor, fallback.brandKit.primaryColor),
      accentColor: color(rawBrand.accentColor, fallback.brandKit.accentColor),
      textColor: color(rawBrand.textColor, fallback.brandKit.textColor),
      backgroundColor: color(rawBrand.backgroundColor, fallback.brandKit.backgroundColor),
      typography: text(rawBrand.typography, fallback.brandKit.typography),
      highContrastButtons: typeof rawBrand.highContrastButtons === "boolean"
        ? rawBrand.highContrastButtons
        : fallback.brandKit.highContrastButtons,
    },
  };
}

export function serializeEmailDocument(document: EmailDocument): string {
  return JSON.stringify(normalizeEmailDocument(JSON.stringify(document)));
}

export function shouldAcknowledgeSave(savedRevision: number, currentRevision: number) {
  return savedRevision === currentRevision;
}