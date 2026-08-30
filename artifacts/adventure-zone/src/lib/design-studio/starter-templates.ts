import {
  createDefaultCanvas,
  createShapeNode,
  createTextNode,
  type CanvasDocument,
} from "./model";
import type { DesignType } from "../design-studio-api";

const PRIMARY = "hsl(var(--primary))";
const ACCENT = "hsl(var(--accent))";
const FOREGROUND = "hsl(var(--foreground))";
const CARD = "hsl(var(--card))";
const SIDEBAR = "hsl(var(--sidebar))";

function canvasWith(nodes: CanvasDocument["pages"][number]["nodes"], background = CARD): CanvasDocument {
  const canvas = createDefaultCanvas();
  const page = canvas.pages[0]!;
  return {
    ...canvas,
    activePageId: page.id,
    pages: [{ ...page, background, nodes }],
  };
}

export function createStarterCanvas(type: DesignType): CanvasDocument {
  if (type === "flyer") {
    return canvasWith([
      createShapeNode("rectangle", {
        name: "Poster background",
        x: 0,
        y: 0,
        width: 960,
        height: 720,
        fill: SIDEBAR,
        locked: true,
      }),
      createShapeNode("circle", {
        name: "Adventure badge",
        x: 650,
        y: 55,
        width: 230,
        height: 230,
        fill: ACCENT,
      }),
      createTextNode({
        name: "Main headline",
        text: "YOUR NEXT ADVENTURE",
        x: 72,
        y: 105,
        width: 580,
        height: 170,
        color: CARD,
        fontFamily: "Impact",
        fontSize: 66,
        lineHeight: 1,
      }),
      createTextNode({
        name: "Event details",
        text: "A one-of-a-kind experience for your group",
        x: 76,
        y: 315,
        width: 540,
        height: 90,
        color: CARD,
        fontSize: 28,
        fontWeight: 400,
      }),
      createShapeNode("rectangle", {
        name: "Call to action",
        x: 74,
        y: 505,
        width: 365,
        height: 86,
        fill: PRIMARY,
        cornerRadius: 18,
      }),
      createTextNode({
        name: "Call to action text",
        text: "BOOK YOUR DATE",
        x: 105,
        y: 520,
        width: 305,
        height: 54,
        color: CARD,
        fontFamily: "Impact",
        fontSize: 30,
        align: "center",
      }),
    ], SIDEBAR);
  }

  if (type === "social post") {
    return canvasWith([
      createShapeNode("rectangle", {
        name: "Social background",
        x: 0,
        y: 0,
        width: 960,
        height: 720,
        fill: PRIMARY,
        locked: true,
      }),
      createShapeNode("star", {
        name: "Featured star",
        x: 610,
        y: 95,
        width: 260,
        height: 260,
        fill: ACCENT,
        rotation: 8,
      }),
      createTextNode({
        name: "Social headline",
        text: "MAKE A STORY\nWORTH TELLING",
        x: 75,
        y: 105,
        width: 545,
        height: 240,
        color: CARD,
        fontFamily: "Impact",
        fontSize: 62,
        lineHeight: 1.05,
      }),
      createTextNode({
        name: "Social caption",
        text: "Adventure Zone brings unforgettable experiences to your community.",
        x: 82,
        y: 410,
        width: 690,
        height: 100,
        color: CARD,
        fontSize: 27,
        fontWeight: 400,
      }),
      createShapeNode("arrow", {
        name: "Accent arrow",
        x: 690,
        y: 565,
        width: 180,
        height: 42,
        stroke: ACCENT,
        strokeWidth: 10,
      }),
    ], PRIMARY);
  }

  if (type === "brochure") {
    return canvasWith([
      createShapeNode("rectangle", {
        name: "Brochure header",
        x: 0,
        y: 0,
        width: 960,
        height: 190,
        fill: SIDEBAR,
        locked: true,
      }),
      createTextNode({
        name: "Brochure title",
        text: "ADVENTURE ZONE",
        x: 55,
        y: 50,
        width: 850,
        height: 90,
        color: CARD,
        fontFamily: "Impact",
        fontSize: 58,
        align: "center",
      }),
      createShapeNode("rectangle", {
        name: "Details panel",
        x: 55,
        y: 245,
        width: 405,
        height: 385,
        fill: "hsl(var(--secondary))",
        cornerRadius: 20,
      }),
      createShapeNode("rectangle", {
        name: "Experience panel",
        x: 500,
        y: 245,
        width: 405,
        height: 385,
        fill: "hsl(var(--muted))",
        cornerRadius: 20,
      }),
      createTextNode({
        name: "Details copy",
        text: "THE DETAILS\n\nAdd dates, location, package information, and everything guests need to know.",
        x: 88,
        y: 285,
        width: 335,
        height: 290,
        color: FOREGROUND,
        fontSize: 25,
        lineHeight: 1.35,
      }),
      createTextNode({
        name: "Experience copy",
        text: "THE EXPERIENCE\n\nDescribe what makes this event exciting, memorable, and perfect for the group.",
        x: 535,
        y: 285,
        width: 335,
        height: 290,
        color: FOREGROUND,
        fontSize: 25,
        lineHeight: 1.35,
      }),
    ]);
  }

  return createDefaultCanvas();
}

export function starterContent(type: DesignType): string | undefined {
  if (type === "email") {
    return "Hi {{contact_name}},\n\nWe would love to bring an Adventure Zone experience to {{organization_name}}. Here are the event details and next steps.\n\nTalk soon,\nAdventure Zone";
  }
  if (type === "review request") {
    return "Thank you for adventuring with us! If your group had a great experience, would you take a moment to share a review?";
  }
  if (type === "contract") {
    return "Adventure Zone Event Agreement\n\nEvent details, services, payment terms, safety requirements, and signature blocks will be completed before this agreement is prepared for signing.";
  }
  return undefined;
}