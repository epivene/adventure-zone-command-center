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

export const STARTER_PHOTOS = {
  polarBear: {
    id: "builtin-polar-bear",
    name: "Sabretooth & Polar Bear",
    url: "https://static.wixstatic.com/media/81786c_03c4528320c64347805d5ecfb2d15fc6~mv2.jpg/v1/fill/w_700,h_700,al_c,q_85/81786c_03c4528320c64347805d5ecfb2d15fc6~mv2.jpg",
  },
  joust: {
    id: "builtin-action-arena",
    name: "Action Arena",
    url: "https://static.wixstatic.com/media/81786c_53777ae5a685418aa8b0f2d2cc1a3389~mv2.jpg/v1/fill/w_960,h_638,al_c,q_85/81786c_53777ae5a685418aa8b0f2d2cc1a3389~mv2.jpg",
  },
  obstacle: {
    id: "builtin-obstacle",
    name: "Obstacle Course",
    url: "https://static.wixstatic.com/media/81786c_41e3ae81e9f7495f82d6f7a40a8624ec~mv2.png/v1/fill/w_600,h_530,al_c,q_85/81786c_41e3ae81e9f7495f82d6f7a40a8624ec~mv2.png",
  },
  pirate: {
    id: "builtin-pirate",
    name: "Pirate Attraction",
    url: "https://static.wixstatic.com/media/81786c_b76e99322ab349f582e890f5b18248a3~mv2.png/v1/fill/w_980,h_524,al_c,q_90/81786c_b76e99322ab349f582e890f5b18248a3~mv2.png",
  },
  water: {
    id: "builtin-water",
    name: "Water Slide Action",
    url: "https://static.wixstatic.com/media/81786c_badfcecb67e04dfdac46e86aeb86dd72~mv2.png/v1/fill/w_980,h_653,al_c,q_90/81786c_badfcecb67e04dfdac46e86aeb86dd72~mv2.png",
  },
  pirateCombo: {
    id: "builtin-pirate-combo",
    name: "Pirate Combo",
    url: "https://static.wixstatic.com/media/81786c_9f98479bedc14a7a9036318fa0d93792~mv2.png/v1/fill/w_647,h_378,al_c,q_85/81786c_9f98479bedc14a7a9036318fa0d93792~mv2.png",
  },
} as const;

export const STARTER_PHOTO_LIBRARY = Object.values(STARTER_PHOTOS);

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
  const fallbackName = value.replace(/\n/g, " ").slice(0, 28) || "Text";
  return {
    ...baseNode(id, options.name ?? fallbackName, x, y, width, height),
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
  photoUrl: string,
  options: Partial<ImageNode> = {},
): ImageNode {
  return {
    ...baseNode(id, name, x, y, width, height),
    kind: "image",
    src: photoUrl,
    assetId: null,
    alt: options.alt ?? name,
    fit: options.fit ?? "cover",
    objectPositionX: options.objectPositionX ?? 50,
    objectPositionY: options.objectPositionY ?? 50,
    flipX: options.flipX ?? false,
    flipY: options.flipY ?? false,
    ...options,
  };
}

function document(
  id: string,
  width: number,
  height: number,
  background: string,
  nodes: CanvasNode[],
): CanvasDocument {
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

function posterFrame(id: string, x: number, y: number, width: number, height: number, rotation: number) {
  return shape(id, "rectangle", x, y, width, height, {
    name: "Photo frame",
    fill: "transparent",
    stroke: WHITE,
    strokeWidth: 10,
    rotation,
  });
}

const eventFlyerCanvas = document("event-flyer", 816, 1056, BLACK, [
  shape("ef-brush", "rectangle", 40, 32, 515, 58, { name: "Pink brush", fill: PINK, strokeWidth: 0, rotation: -2 }),
  text("ef-kicker", "★ AMERICA'S BEST BOUNCE HOUSE CARNIVAL! ★", 58, 40, 480, 42, { color: WHITE, fontSize: 23, align: "center" }),
  text("ef-logo", "THE\nADVENTURE\nZONE", 55, 105, 370, 180, { color: WHITE, fontSize: 72, lineHeight: 0.82 }),
  shape("ef-star", "star", 622, 48, 115, 115, { fill: YELLOW, stroke: WHITE, strokeWidth: 7, rotation: 10 }),
  image("ef-photo-1", STARTER_PHOTOS.polarBear.name, 390, 165, 355, 230, STARTER_PHOTOS.polarBear.url, { rotation: 4 }),
  image("ef-photo-2", STARTER_PHOTOS.joust.name, 48, 326, 330, 220, STARTER_PHOTOS.joust.url, { rotation: -4 }),
  image("ef-photo-3", STARTER_PHOTOS.obstacle.name, 403, 424, 330, 206, STARTER_PHOTOS.obstacle.url, { rotation: 3 }),
  posterFrame("ef-frame-2", 35, 313, 356, 246, -4),
  posterFrame("ef-frame-3", 390, 411, 356, 232, 3),
  shape("ef-yellow-block", "rectangle", 44, 612, 728, 177, { fill: YELLOW, stroke: BLACK, strokeWidth: 8, rotation: -1 }),
  text("ef-event", "[EVENT NAME]", 76, 632, 665, 82, { color: BLACK, fontSize: 56, align: "center" }),
  text("ef-meta", "[DATE] • [TIME]\n[LOCATION]", 90, 705, 632, 65, { color: BLACK, fontSize: 28, fontFamily: "Trebuchet MS", align: "center", lineHeight: 1.05 }),
  shape("ef-price", "circle", 56, 814, 175, 175, { name: "Ticket bubble", fill: WHITE, stroke: PINK, strokeWidth: 9, rotation: -5 }),
  text("ef-ticket", "[TICKET\nINFO]", 75, 850, 135, 92, { color: BLACK, fontSize: 30, align: "center", lineHeight: 0.95 }),
  shape("ef-cta-bg", "rectangle", 266, 835, 472, 108, { name: "CTA sticker", fill: PINK, stroke: WHITE, strokeWidth: 8, rotation: 2 }),
  text("ef-cta", "COME PLAY WITH US! →", 295, 863, 414, 48, { color: WHITE, fontSize: 34, align: "center" }),
  text("ef-footer", "the-adventure-zone.com  •  Booking (435) 760-5583", 250, 986, 510, 32, { color: WHITE, fontSize: 19, fontFamily: "Trebuchet MS", align: "right" }),
]);

const socialPostCanvas = document("social-post", 1080, 1350, BLACK, [
  image("sp-photo", STARTER_PHOTOS.joust.name, 0, 0, 1080, 770, STARTER_PHOTOS.joust.url),
  shape("sp-overlay", "rectangle", 0, 0, 1080, 770, { name: "Dark photo overlay", fill: NAVY, strokeWidth: 0, opacity: 0.45 }),
  shape("sp-brush", "rectangle", 68, 72, 650, 82, { name: "Pink brush", fill: PINK, strokeWidth: 0, rotation: -2 }),
  text("sp-kicker", "★ WE BRING THE ACTION ★", 96, 88, 596, 54, { color: WHITE, fontSize: 37, align: "center" }),
  text("sp-title", "BIG DAY.\nBIG FUN.", 70, 205, 875, 285, { color: WHITE, fontSize: 122, lineHeight: 0.82 }),
  text("sp-event", "[EVENT NAME]", 80, 520, 895, 105, { color: YELLOW, fontSize: 76 }),
  shape("sp-arrow", "arrow", 858, 604, 150, 16, { fill: YELLOW, stroke: YELLOW, strokeWidth: 11, rotation: -8 }),
  shape("sp-meta-bg", "rectangle", 70, 830, 940, 235, { name: "Event info sticker", fill: YELLOW, stroke: WHITE, strokeWidth: 9, rotation: 1 }),
  text("sp-meta", "[DATE] • [TIME]\n[CITY, STATE]", 110, 867, 860, 150, { color: BLACK, fontSize: 55, fontFamily: "Trebuchet MS", align: "center", lineHeight: 1.05 }),
  shape("sp-cta-bg", "rectangle", 128, 1110, 824, 118, { name: "CTA sticker", fill: PINK, stroke: WHITE, strokeWidth: 8, rotation: -1 }),
  text("sp-cta", "BRING THE WHOLE CREW →", 160, 1143, 760, 58, { color: WHITE, fontSize: 47, align: "center" }),
  text("sp-footer", "THE ADVENTURE ZONE • the-adventure-zone.com", 166, 1271, 748, 35, { color: WHITE, fontSize: 24, fontFamily: "Trebuchet MS", align: "center" }),
]);

const openDateCanvas = document("last-minute-booking", 1080, 1350, CREAM, [
  shape("od-black", "rectangle", 0, 0, 1080, 570, { name: "Black hero block", fill: BLACK, strokeWidth: 0 }),
  image("od-photo", STARTER_PHOTOS.polarBear.name, 478, 62, 520, 360, STARTER_PHOTOS.polarBear.url, { rotation: 4 }),
  posterFrame("od-frame", 458, 42, 560, 400, 4),
  shape("od-brush", "rectangle", 62, 78, 440, 78, { name: "Open date brush", fill: PINK, strokeWidth: 0, rotation: -3 }),
  text("od-alert", "OPEN DATE ALERT", 82, 92, 400, 50, { color: WHITE, fontSize: 38, align: "center" }),
  text("od-title", "FILL THE GAP.\nBRING THE FUN.", 68, 194, 500, 205, { color: WHITE, fontSize: 78, lineHeight: 0.85 }),
  shape("od-star", "star", 76, 433, 95, 95, { fill: YELLOW, stroke: WHITE, strokeWidth: 6, rotation: -9 }),
  text("od-route", "Opening near [REGION / ROUTE]", 198, 455, 360, 62, { color: YELLOW, fontSize: 28, fontFamily: "Trebuchet MS" }),
  shape("od-date-bg", "rectangle", 64, 625, 950, 210, { name: "Date sticker", fill: YELLOW, stroke: BLACK, strokeWidth: 10, rotation: -1 }),
  text("od-date-label", "AVAILABLE DATE", 98, 655, 880, 48, { color: BLACK, fontSize: 31, align: "center" }),
  text("od-date", "[AVAILABLE DATE]", 100, 709, 876, 80, { color: BLACK, fontSize: 66, align: "center" }),
  shape("od-card-1", "rectangle", 84, 884, 420, 184, { name: "Feature card", fill: WHITE, stroke: BLACK, strokeWidth: 7, rotation: 1 }),
  shape("od-card-2", "rectangle", 572, 884, 420, 184, { name: "Feature card", fill: WHITE, stroke: BLACK, strokeWidth: 7, rotation: -1 }),
  text("od-features-1", "✓ SETUP & TEARDOWN\n✓ FULL STAFFING", 114, 930, 360, 95, { color: BLACK, fontSize: 29, fontFamily: "Trebuchet MS", lineHeight: 1.25 }),
  text("od-features-2", "✓ FULLY INSURED\n✓ TURNKEY FUN", 602, 930, 360, 95, { color: BLACK, fontSize: 29, fontFamily: "Trebuchet MS", lineHeight: 1.25 }),
  shape("od-cta-bg", "rectangle", 126, 1125, 828, 122, { name: "CTA sticker", fill: PINK, stroke: BLACK, strokeWidth: 8, rotation: -1 }),
  text("od-cta", "LET'S TALK DATES • (435) 760-5583", 154, 1161, 772, 56, { color: WHITE, fontSize: 39, align: "center" }),
]);

const packageCanvas = document("package-overview", 816, 1056, BLACK, [
  text("pk-kicker", "— THE FLEET —", 214, 34, 388, 42, { color: YELLOW, fontSize: 28, align: "center" }),
  text("pk-title", "EPIC PACKAGES", 94, 82, 628, 84, { color: WHITE, fontSize: 70, align: "center" }),
  text("pk-sub", "Fully staffed for 1–4 days.", 208, 169, 400, 34, { color: WHITE, fontSize: 22, fontFamily: "Trebuchet MS", align: "center" }),
  image("pk-photo-az", STARTER_PHOTOS.polarBear.name, 54, 246, 300, 184, STARTER_PHOTOS.polarBear.url, { rotation: -2 }),
  posterFrame("pk-frame-az", 42, 234, 324, 208, -2),
  shape("pk-card-az", "rectangle", 374, 228, 386, 228, { name: "Adventure Zone card", fill: CREAM, stroke: WHITE, strokeWidth: 7, rotation: 1 }),
  text("pk-name-az", "★ ADVENTURE ZONE", 400, 251, 332, 48, { color: BLACK, fontSize: 31 }),
  text("pk-copy-az", "10 premium attractions\nGiant slides • obstacles • bounces", 402, 312, 326, 70, { color: BLACK, fontSize: 20, fontFamily: "Trebuchet MS", lineHeight: 1.2 }),
  text("pk-price-az", "$9,000", 406, 389, 215, 48, { color: PINK, fontSize: 38 }),
  image("pk-photo-pirate", STARTER_PHOTOS.pirate.name, 70, 514, 288, 174, STARTER_PHOTOS.pirate.url, { rotation: 2 }),
  shape("pk-card-pirate", "rectangle", 378, 498, 368, 206, { name: "Pirate package card", fill: CREAM, stroke: WHITE, strokeWidth: 7, rotation: -1 }),
  text("pk-name-pirate", "⚓ PIRATE'S REBELLION", 401, 522, 323, 50, { color: BLACK, fontSize: 27 }),
  text("pk-copy-pirate", "Water & pirate-themed fun\nBoats • wet attractions • games", 402, 579, 315, 68, { color: BLACK, fontSize: 18, fontFamily: "Trebuchet MS", lineHeight: 1.2 }),
  text("pk-price-pirate", "$8,000", 407, 652, 190, 42, { color: PINK, fontSize: 35 }),
  image("pk-photo-warrior", STARTER_PHOTOS.joust.name, 72, 764, 286, 166, STARTER_PHOTOS.joust.url, { rotation: -2 }),
  shape("pk-card-warrior", "rectangle", 378, 746, 370, 203, { name: "Warrior package card", fill: CREAM, stroke: WHITE, strokeWidth: 7, rotation: 1 }),
  text("pk-name-warrior", "◎ WARRIOR'S PLAYGROUND", 398, 770, 330, 50, { color: BLACK, fontSize: 25 }),
  text("pk-copy-warrior", "Paintball • AirSoft • Orbeez\n+ four additional attractions", 402, 826, 318, 67, { color: BLACK, fontSize: 18, fontFamily: "Trebuchet MS", lineHeight: 1.2 }),
  text("pk-price-warrior", "$8,000", 405, 900, 190, 42, { color: PINK, fontSize: 35 }),
  text("pk-footer", "SETUP • STAFFING • FULLY INSURED • TEARDOWN", 120, 998, 580, 30, { color: YELLOW, fontSize: 19, fontFamily: "Trebuchet MS", align: "center" }),
]);

const reviewCanvas = document("review-request", 1080, 1080, CREAM, [
  shape("rv-black", "rectangle", 0, 0, 1080, 340, { name: "Black hero block", fill: BLACK, strokeWidth: 0 }),
  image("rv-photo", STARTER_PHOTOS.water.name, 556, 48, 444, 270, STARTER_PHOTOS.water.url, { rotation: 3 }),
  posterFrame("rv-frame", 536, 29, 484, 308, 3),
  shape("rv-brush", "rectangle", 62, 62, 430, 66, { name: "Thank-you brush", fill: PINK, strokeWidth: 0, rotation: -3 }),
  text("rv-thanks", "THANKS FOR THE BIG DAY!", 80, 76, 392, 42, { color: WHITE, fontSize: 28, align: "center" }),
  text("rv-title", "HOW'D\nWE DO?", 74, 147, 420, 160, { color: WHITE, fontSize: 80, lineHeight: 0.84 }),
  shape("rv-star", "star", 80, 390, 150, 150, { fill: YELLOW, stroke: BLACK, strokeWidth: 9, rotation: -6 }),
  text("rv-stars", "★ ★ ★ ★ ★", 288, 409, 700, 80, { color: PINK, fontSize: 64, align: "center" }),
  text("rv-event", "[EVENT NAME]", 190, 522, 700, 74, { color: BLACK, fontSize: 50, align: "center" }),
  text("rv-body", "Your feedback helps us recognize great leg managers, improve the experience, and make next year even better.", 145, 620, 790, 108, { color: BLACK, fontSize: 31, fontFamily: "Trebuchet MS", align: "center", lineHeight: 1.25 }),
  shape("rv-qr", "rectangle", 105, 772, 230, 230, { name: "QR code box", fill: WHITE, stroke: BLACK, strokeWidth: 10, rotation: -2 }),
  text("rv-qr-label", "[QR CODE]", 142, 857, 160, 48, { color: BLACK, fontSize: 28, align: "center" }),
  shape("rv-cta-bg", "rectangle", 382, 804, 594, 130, { name: "Review CTA sticker", fill: YELLOW, stroke: BLACK, strokeWidth: 10, rotation: 1 }),
  text("rv-cta", "SHARE YOUR\nEXPERIENCE →", 425, 831, 510, 83, { color: BLACK, fontSize: 43, align: "center", lineHeight: 0.9 }),
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
    content: `THE ADVENTURE ZONE\n\nOPEN DATE ALERT\nFILL THE GAP. BRING THE FUN.\n[REGION / ROUTE]\n[AVAILABLE DATE]\n\n✓ SETUP & TEARDOWN\n✓ FULL STAFFING\n✓ FULLY INSURED\n✓ TURNKEY FUN\n\nLET'S TALK DATES • (435) 760-5583`,
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
    content: `THE ADVENTURE ZONE\n\nEPIC PACKAGES\n\nADVENTURE ZONE — $9,000 / 1–4 DAYS\nPIRATE'S REBELLION — $8,000 / 1–4 DAYS\nWARRIOR'S PLAYGROUND — $8,000 / 1–4 DAYS\n\nSETUP • STAFFING • FULLY INSURED • TEARDOWN`,
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
