import type { DesignType } from "@/lib/design-studio-api";
import type {
  CanvasDocument,
  CanvasNode,
  ImageNode,
  ShapeNode,
  TextNode,
} from "@/lib/design-studio/model";

const BLACK = "#080808";
const CREAM = "#f7f1df";
const PINK = "#ff1791";
const YELLOW = "#ffd21c";
const WHITE = "#ffffff";
const NAVY = "#11192d";

function baseNode(id: string, name: string, x: number, y: number, width: number, height: number) {
  return {
    id,
    name,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: null,
  };
}

function text(
  id: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<TextNode> = {},
): TextNode {
  return {
    ...baseNode(id, options.name ?? value.replace(/\n/g, " ").slice(0, 28) || "Text", x, y, width, height),
    kind: "text",
    text: value,
    color: options.color ?? BLACK,
    fontSize: options.fontSize ?? 36,
    fontWeight: options.fontWeight ?? 800,
    fontFamily: options.fontFamily ?? "Impact",
    italic: options.italic ?? false,
    underline: options.underline ?? false,
    letterSpacing: options.letterSpacing ?? 0,
    lineHeight: options.lineHeight ?? 1,
    align: options.align ?? "left",
    ...options,
  };
}

function shape(
  id: string,
  variant: ShapeNode["variant"],
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<ShapeNode> = {},
): ShapeNode {
  return {
    ...baseNode(id, options.name ?? `${variant} sticker`, x, y, width, height),
    kind: "shape",
    variant,
    fill: options.fill ?? PINK,
    stroke: options.stroke ?? BLACK,
    strokeWidth: options.strokeWidth ?? 5,
    cornerRadius: options.cornerRadius ?? 0,
    flipX: options.flipX ?? false,
    flipY: options.flipY ?? false,
    ...options,
  };
}

function image(
  id: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<ImageNode> = {},
): ImageNode {
  return {
    ...baseNode(id, name, x, y, width, height),
    kind: "image",
    src: options.src ?? null,
    assetId: options.assetId ?? null,
    alt: options.alt ?? name,
    fit: options.fit ?? "cover",
    objectPositionX: options.objectPositionX ?? 50,
    objectPositionY: options.objectPositionY ?? 50,
    flipX: options.flipX ?? false,
    flipY: options.flipY ?? false,
    ...options,
  };
}

function document(id: string, width: number, height: number, background: string, nodes: CanvasNode[]): CanvasDocument {
  const pageId = `${id}-page`;
  return {
    version: 2,
    width,
    height,
    showGrid: false,
    gridSize: 16,
    zoom: 1,
    activePageId: pageId,
    pages: [{ id: pageId, name: "Page 1", background, nodes }],
  };
}

const eventFlyerCanvas = document("event-flyer", 816, 1056, BLACK, [
  shape("ef-pink-brush", "rectangle", 40, 32, 515, 58, { fill: PINK, strokeWidth: 0, rotation: -2 }),
  text("ef-kicker", "★ AMERICA'S BEST BOUNCE HOUSE CARNIVAL! ★", 58, 40, 480, 42, { color: WHITE, fontSize: 23, fontFamily: "Impact", align: "center" }),
  text("ef-logo", "THE\nADVENTURE\nZONE", 55, 105, 370, 180, { color: WHITE, fontSize: 72, lineHeight: 0.82 }),
  shape("ef-yellow-star", "star", 622, 48, 115, 115, { fill: YELLOW, stroke: WHITE, strokeWidth: 7, rotation: 10 }),
  image("ef-photo-aerial", "Aerial carnival photo", 390, 165, 355, 230, { rotation: 4 }),
  image("ef-photo-tiger", "Sabretooth and polar bear photo", 48, 326, 330, 220, { rotation: -4 }),
  image("ef-photo-action", "Action arena photo", 403, 424, 330, 206, { rotation: 3 }),
  shape("ef-photo-frame-1", "rectangle", 35, 313, 356, 246, { fill: "transparent", stroke: WHITE, strokeWidth: 10, rotation: -4 }),
  shape("ef-photo-frame-2", "rectangle", 390, 411, 356, 232, { fill: "transparent", stroke: WHITE, strokeWidth: 10, rotation: 3 }),
  shape("ef-yellow-block", "rectangle", 44, 612, 728, 177, { fill: YELLOW, stroke: BLACK, strokeWidth: 8, rotation: -1 }),
  text("ef-event-name", "[EVENT NAME]", 76, 632, 665, 82, { color: BLACK, fontSize: 56, align: "center" }),
  text("ef-event-meta", "[DATE] • [TIME]\n[LOCATION]", 90, 705, 632, 65, { color: BLACK, fontSize: 28, fontFamily: "Trebuchet MS", align: "center", lineHeight: 1.05 }),
  shape("ef-price-bubble", "circle", 56, 814, 175, 175, { fill: WHITE, stroke: PINK, strokeWidth: 9, rotation: -5 }),
  text("ef-ticket", "[TICKET\nINFO]", 75, 850, 135, 92, { color: BLACK, fontSize: 30, align: "center", lineHeight: 0.95 }),
  shape("ef-cta", "rectangle", 266, 835, 472, 108, { fill: PINK, stroke: WHITE, strokeWidth: 8, rotation: 2 }),
  text("ef-cta-text", "COME PLAY WITH US! →", 295, 863, 414, 48, { color: WHITE, fontSize: 34, align: "center" }),
  text("ef-footer", "the-adventure-zone.com  •  Booking (435) 760-5583", 250, 986, 510, 32, { color: WHITE, fontSize: 19, fontFamily: "Trebuchet MS", align: "right" }),
]);

const socialPostCanvas = document("social-post", 1080, 1350, BLACK, [
  image("sp-photo-hero", "Kids in action photo", 0, 0, 1080, 770),
  shape("sp-dark-overlay", "rectangle", 0, 0, 1080, 770, { fill: NAVY, strokeWidth: 0, opacity: 0.45 }),
  shape("sp-pink-brush", "rectangle", 68, 72, 650, 82, { fill: PINK, strokeWidth: 0, rotation: -2 }),
  text("sp-kicker", "★ WE BRING THE ACTION ★", 96, 88, 596, 54, { color: WHITE, fontSize: 37, align: "center" }),
  text("sp-big", "BIG DAY.\nBIG FUN.", 70, 205, 875, 285, { color: WHITE, fontSize: 122, lineHeight: 0.82 }),
  text("sp-yellow", "[EVENT NAME]", 80, 520, 895, 105, { color: YELLOW, fontSize: 76 }),
  shape("sp-arrow", "arrow", 858, 604, 150, 16, { fill: YELLOW, stroke: YELLOW, strokeWidth: 11, rotation: -8 }),
  shape("sp-meta-card", "rectangle", 70, 830, 940, 235, { fill: YELLOW, stroke: WHITE, strokeWidth: 9, rotation: 1 }),
  text("sp-meta", "[DATE] • [TIME]\n[CITY, STATE]", 110, 867, 860, 150, { color: BLACK, fontSize: 55, fontFamily: "Trebuchet MS", align: "center", lineHeight: 1.05 }),
  shape("sp-cta-card", "rectangle", 128, 1110, 824, 118, { fill: PINK, stroke: WHITE, strokeWidth: 8, rotation: -1 }),
  text("sp-cta", "BRING THE WHOLE CREW →", 160, 1143, 760, 58, { color: WHITE, fontSize: 47, align: "center" }),
  text("sp-footer", "THE ADVENTURE ZONE • the-adventure-zone.com", 166, 1271, 748, 35, { color: WHITE, fontSize: 24, fontFamily: "Trebuchet MS", align: "center" }),
]);

const openDateCanvas = document("last-minute-booking", 1080, 1350, CREAM, [
  shape("od-black-panel", "rectangle", 0, 0, 1080, 570, { fill: BLACK, strokeWidth: 0 }),
  image("od-photo", "Aerial carnival photo", 478, 62, 520, 360, { rotation: 4 }),
  shape("od-frame", "rectangle", 458, 42, 560, 400, { fill: "transparent", stroke: WHITE, strokeWidth: 12, rotation: 4 }),
  shape("od-pink", "rectangle", 62, 78, 440, 78, { fill: PINK, strokeWidth: 0, rotation: -3 }),
  text("od-alert", "OPEN DATE ALERT", 82, 92, 400, 50, { color: WHITE, fontSize: 38, align: "center" }),
  text("od-title", "FILL THE GAP.\nBRING THE FUN.", 68, 194, 500, 205, { color: WHITE, fontSize: 78, lineHeight: 0.85 }),
  shape("od-star", "star", 76, 433, 95, 95, { fill: YELLOW, stroke: WHITE, strokeWidth: 6, rotation: -9 }),
  text("od-route", "Opening near [REGION / ROUTE]", 198, 455, 360, 62, { color: YELLOW, fontSize: 28, fontFamily: "Trebuchet MS" }),
  shape("od-date", "rectangle", 64, 625, 950, 210, { fill: YELLOW, stroke: BLACK, strokeWidth: 10, rotation: -1 }),
  text("od-date-label", "AVAILABLE DATE", 98, 655, 880, 48, { color: BLACK, fontSize: 31, align: "center" }),
  text("od-date-value", "[AVAILABLE DATE]", 100, 709, 876, 80, { color: BLACK, fontSize: 66, align: "center" }),
  shape("od-card-1", "rectangle", 84, 884, 420, 184, { fill: WHITE, stroke: BLACK, strokeWidth: 7, rotation: 1 }),
  shape("od-card-2", "rectangle", 572, 884, 420, 184, { fill: WHITE, stroke: BLACK, strokeWidth: 7, rotation: -1 }),
  text("od-features-1", "✓ SETUP & TEARDOWN\n✓ FULL STAFFING", 114, 930, 360, 95, { color: BLACK, fontSize: 29, fontFamily: "Trebuchet MS", lineHeight: 1.25 }),
  text("od-features-2", "✓ $2M INSURANCE\n✓ TURNKEY FUN", 602, 930, 360, 95, { color: BLACK, fontSize: 29, fontFamily: "Trebuchet MS", lineHeight: 1.25 }),
  shape("od-cta", "rectangle", 126, 1125, 828, 122, { fill: PINK, stroke: BLACK, strokeWidth: 8, rotation: -1 }),
  text("od-cta-text", "LET'S TALK DATES • (435) 760-5583", 154, 1161, 772, 56, { color: WHITE, fontSize: 39, align: "center" }),
]);

const packageCanvas = document("package-overview", 816, 1056, BLACK, [
  text("pk-kicker", "— THE FLEET —", 214, 34, 388, 42, { color: YELLOW, fontSize: 28, align: "center" }),
  text("pk-title", "EPIC PACKAGES", 94, 82, 628, 84, { color: WHITE, fontSize: 70, align: "center" }),
  text("pk-sub", "Fully staffed for 1–4 days.", 208, 169, 400, 34, { color: WHITE, fontSize: 22, fontFamily: "Trebuchet MS", align: "center" }),
  image("pk-az-photo", "Adventure Zone carnival photo", 54, 246, 300, 184, { rotation: -2 }),
  shape("pk-az-frame", "rectangle", 42, 234, 324, 208, { fill: "transparent", stroke: WHITE, strokeWidth: 9, rotation: -2 }),
  shape("pk-az-card", "rectangle", 374, 228, 386, 228, { fill: CREAM, stroke: WHITE, strokeWidth: 7, rotation: 1 }),
  text("pk-az-name", "★ ADVENTURE ZONE", 400, 251, 332, 48, { color: BLACK, fontSize: 31 }),
  text("pk-az-copy", "10 premium attractions\nGiant slides • obstacles • bounces", 402, 312, 326, 70, { color: BLACK, fontSize: 20, fontFamily: "Trebuchet MS", lineHeight: 1.2 }),
  text("pk-az-price", "$9,000", 406, 389, 215, 48, { color: PINK, fontSize: 38 }),
  image("pk-pirate-photo", "Pirate attraction photo", 70, 514, 288, 174, { rotation: 2 }),
  shape("pk-pirate-card", "rectangle", 378, 498, 368, 206, { fill: CREAM, stroke: WHITE, strokeWidth: 7, rotation: -1 }),
  text("pk-pirate-name", "⚓ PIRATE'S REBELLION", 401, 522, 323, 50, { color: BLACK, fontSize: 27 }),
  text("pk-pirate-copy", "Water & pirate-themed fun\nBoats • wet attractions • games", 402, 579, 315, 68, { color: BLACK, fontSize: 18, fontFamily: "Trebuchet MS", lineHeight: 1.2 }),
  text("pk-pirate-price", "$7,500", 407, 652, 190, 42, { color: PINK, fontSize: 35 }),
  image("pk-warrior-photo", "Action arena photo", 72, 764, 286, 166, { rotation: -2 }),
  shape("pk-warrior-card", "rectangle", 378, 746, 370, 203, { fill: CREAM, stroke: WHITE, strokeWidth: 7, rotation: 1 }),
  text("pk-warrior-name", "◎ WARRIOR'S PLAYGROUND", 398, 770, 330, 50, { color: BLACK, fontSize: 25 }),
  text("pk-warrior-copy", "Paintball • AirSoft • Orbeez\n+ four additional attractions", 402, 826, 318, 67, { color: BLACK, fontSize: 18, fontFamily: "Trebuchet MS", lineHeight: 1.2 }),
  text("pk-warrior-price", "$7,500", 405, 900, 190, 42, { color: PINK, fontSize: 35 }),
  text("pk-footer", "SETUP • STAFFING • $2M INSURANCE • TEARDOWN", 120, 998, 580, 30, { color: YELLOW, fontSize: 19, fontFamily: "Trebuchet MS", align: "center" }),
]);

const reviewCanvas = document("review-request", 1080, 1080, CREAM, [
  shape("rv-black", "rectangle", 0, 0, 1080, 340, { fill: BLACK, strokeWidth: 0 }),
  image("rv-photo", "Kids in action photo", 556, 48, 444, 270, { rotation: 3 }),
  shape("rv-photo-frame", "rectangle", 536, 29, 484, 308, { fill: "transparent", stroke: WHITE, strokeWidth: 11, rotation: 3 }),
  shape("rv-pink", "rectangle", 62, 62, 430, 66, { fill: PINK, strokeWidth: 0, rotation: -3 }),
  text("rv-thanks", "THANKS FOR THE BIG DAY!", 80, 76, 392, 42, { color: WHITE, fontSize: 28, align: "center" }),
  text("rv-title", "HOW'D\nWE DO?", 74, 147, 420, 160, { color: WHITE, fontSize: 80, lineHeight: 0.84 }),
  shape("rv-yellow-star", "star", 80, 390, 150, 150, { fill: YELLOW, stroke: BLACK, strokeWidth: 9, rotation: -6 }),
  text("rv-stars", "★ ★ ★ ★ ★", 288, 409, 700, 80, { color: PINK, fontSize: 64, align: "center" }),
  text("rv-event", "[EVENT NAME]", 190, 522, 700, 74, { color: BLACK, fontSize: 50, align: "center" }),
  text("rv-body", "Your feedback helps us recognize great leg managers, improve the experience, and make next year even better.", 145, 620, 790, 108, { color: BLACK, fontSize: 31, fontFamily: "Trebuchet MS", align: "center", lineHeight: 1.25 }),
  shape("rv-qr", "rectangle", 105, 772, 230, 230, { fill: WHITE, stroke: BLACK, strokeWidth: 10, rotation: -2 }),
  text("rv-qr-label", "[QR CODE]", 142, 857, 160, 48, { color: BLACK, fontSize: 28, align: "center" }),
  shape("rv-cta", "rectangle", 382, 804, 594, 130, { fill: YELLOW, stroke: BLACK, strokeWidth: 10, rotation: 1 }),
  text("rv-cta-text", "SHARE YOUR\nEXPERIENCE →", 425, 831, 510, 83, { color: BLACK, fontSize: 43, align: "center", lineHeight: 0.9 }),
  text("rv-footer", "the-adventure-zone.com", 515, 992, 420, 34, { color: BLACK, fontSize: 24, fontFamily: "Trebuchet MS", align: "right" }),
]);

export type CanvaStarter = {
  id: string;
  name: string;
  type: DesignType;
  eyebrow: string;
  headline: string;
  description: string;
  canvasSize: string;
  accent: "pink" | "yellow" | "blue" | "orange" | "navy";
  content: string;
  canvas: CanvasDocument;
};

export const CANVA_STARTERS: CanvaStarter[] = [
  {
    id: "event-flyer",
    name: "Big Day Event Flyer",
    type: "flyer",
    eyebrow: "AMERICA'S BEST BOUNCE HOUSE CARNIVAL",
    headline: "We Bring the Action",
    description: "A scrapbook-style carnival poster with crooked photo frames, bright stickers, ticket bubble, and oversized event blocks.",
    canvasSize: "US Letter / Flyer",
    accent: "pink",
    canvas: eventFlyerCanvas,
    content: `THE ADVENTURE ZONE\n\n★ AMERICA'S BEST BOUNCE HOUSE CARNIVAL! ★\n\n[EVENT NAME]\n[DATE] • [TIME]\n[LOCATION]\n\n[TICKET INFO]\n\nCOME PLAY WITH US!\nBooking: (435) 760-5583\nthe-adventure-zone.com`,
  },
  {
    id: "social-post",
    name: "We Bring the Action Social Post",
    type: "social post",
    eyebrow: "WE BRING THE ACTION",
    headline: "Big Day. Big Fun.",
    description: "A photo-heavy social poster with dark action imagery, hot-pink brush label, huge headline, and stacked event stickers.",
    canvasSize: "1080 × 1350",
    accent: "yellow",
    canvas: socialPostCanvas,
    content: `THE ADVENTURE ZONE\n\n★ WE BRING THE ACTION ★\n\nBIG DAY. BIG FUN.\n[EVENT NAME]\n[DATE] • [TIME]\n[CITY, STATE]\n\nBRING THE WHOLE CREW →`,
  },
  {
    id: "last-minute-booking",
    name: "Open Date Booking Promo",
    type: "social post",
    eyebrow: "OPEN DATE ALERT",
    headline: "Fill the Gap. Bring the Fun.",
    description: "A loud last-minute booking poster with a crooked photo, giant date sticker, feature cards, and pink booking banner.",
    canvasSize: "1080 × 1350",
    accent: "orange",
    canvas: openDateCanvas,
    content: `THE ADVENTURE ZONE\n\nOPEN DATE ALERT\nFILL THE GAP. BRING THE FUN.\n[REGION / ROUTE]\n[AVAILABLE DATE]\n\n✓ SETUP & TEARDOWN\n✓ FULL STAFFING\n✓ $2M INSURANCE\n✓ TURNKEY FUN\n\nLET'S TALK DATES • (435) 760-5583`,
  },
  {
    id: "package-overview",
    name: "Epic Packages One-Sheet",
    type: "brochure",
    eyebrow: "THE FLEET",
    headline: "Epic Packages",
    description: "A photo-card package sheet with three independently editable package blocks and bold pricing.",
    canvasSize: "US Letter",
    accent: "blue",
    canvas: packageCanvas,
    content: `THE ADVENTURE ZONE\n\nEPIC PACKAGES\n\nADVENTURE ZONE — $9,000 / 1–4 DAYS\nPIRATE'S REBELLION — $7,500 / 1–4 DAYS\nWARRIOR'S PLAYGROUND — $7,500 / 1–4 DAYS\n\nSETUP • STAFFING • $2M INSURANCE • TEARDOWN`,
  },
  {
    id: "review-request",
    name: "Big Day Review Request",
    type: "review request",
    eyebrow: "THANKS FOR THE BIG DAY",
    headline: "How'd We Do?",
    description: "A celebratory review poster with action photo, star sticker, rating row, QR block, and oversized review CTA.",
    canvasSize: "1080 × 1080",
    accent: "navy",
    canvas: reviewCanvas,
    content: `THE ADVENTURE ZONE\n\nTHANKS FOR THE BIG DAY!\nHOW'D WE DO?\n★ ★ ★ ★ ★\n\n[EVENT NAME]\n[REVIEW LINK OR QR CODE]\n\nSHARE YOUR EXPERIENCE →`,
  },
];

export function starterById(id?: string | null) {
  if (!id) return undefined;
  return CANVA_STARTERS.find((starter) => starter.id === id);
}

export function starterByName(name?: string | null) {
  if (!name) return undefined;
  return CANVA_STARTERS.find((starter) => starter.name === name);
}
