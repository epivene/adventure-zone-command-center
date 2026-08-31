import type { DesignType } from "@/lib/design-studio-api";

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
};

export const CANVA_STARTERS: CanvaStarter[] = [
  {
    id: "event-flyer",
    name: "Big Day Event Flyer",
    type: "flyer",
    eyebrow: "AMERICA'S BEST BOUNCE HOUSE CARNIVAL",
    headline: "We Bring the Action",
    description: "A photo-forward event flyer with the same bold navy, yellow, pink, cream, and outlined-block look as the Adventure Zone website.",
    canvasSize: "US Letter / Flyer",
    accent: "pink",
    content: `THE ADVENTURE ZONE\n\n★ AMERICA'S BEST BOUNCE HOUSE CARNIVAL! ★\n\nWE BRING THE ACTION\n\n[EVENT NAME]\n[DATE] • [TIME]\n[VENUE / CITY, STATE]\n\nProfessional, fully staffed traveling inflatable carnival packages for fairs, festivals & major community events.\n\n10 PREMIUM ATTRACTIONS\nGiant slides • obstacle courses • bounces • interactive games\n\n[ADMISSION / TICKET DETAILS]\n\nSEE YOU THERE!\nBooking: (435) 760-5583\nthe-adventure-zone.com`,
  },
  {
    id: "social-post",
    name: "We Bring the Action Social Post",
    type: "social post",
    eyebrow: "THE ADVENTURE ZONE",
    headline: "Big Day. Big Fun.",
    description: "A high-impact social graphic modeled after the website hero: dark photo treatment, hot-pink label, giant white/yellow headline, and chunky CTA.",
    canvasSize: "1080 × 1350",
    accent: "yellow",
    content: `THE ADVENTURE ZONE\n\n★ WE BRING THE ACTION ★\n\nBIG DAY.\nBIG FUN.\n\nFind us at [EVENT NAME]\n[DATE] • [CITY, STATE]\n\nSlides • Challenges • Games • Bounces\n\nBRING THE WHOLE CREW →\nthe-adventure-zone.com`,
  },
  {
    id: "last-minute-booking",
    name: "Open Date Booking Promo",
    type: "social post",
    eyebrow: "OPEN DATE ALERT",
    headline: "Fill the Gap.",
    description: "A route-opening promo using the site's cream grid, navy outlined cards, oversized type, yellow date block, and pink booking CTA.",
    canvasSize: "1080 × 1350",
    accent: "orange",
    content: `THE ADVENTURE ZONE\n\nOPEN DATE ALERT\n\nFILL THE GAP.\nBRING THE FUN.\n\nWe have an opening near [REGION / ROUTE]\n\n[AVAILABLE DATE]\n\nTURNKEY EVENT ENTERTAINMENT\n✓ Complete setup & teardown\n✓ Professional staffing\n✓ Commercial-grade attractions\n✓ $2M liability insurance\n\nPerfect for fairs, festivals, rodeos & community events.\n\nLET'S TALK DATES\nBooking: (435) 760-5583\nTheAdventureZone12@gmail.com`,
  },
  {
    id: "package-overview",
    name: "Epic Packages One-Sheet",
    type: "brochure",
    eyebrow: "THE FLEET",
    headline: "Epic Packages",
    description: "A one-sheet based directly on the website's package section: navy field, cream cards, yellow labels, pink icons, bold pricing, and three package choices.",
    canvasSize: "US Letter",
    accent: "blue",
    content: `THE ADVENTURE ZONE\n\n— THE FLEET —\nEPIC PACKAGES\nChoose the footprint that fits your event. Every package comes fully staffed for 1–4 days.\n\n★ ADVENTURE ZONE\nOur massive inflatable carnival built for max capacity and towering visual impact.\n10 premium attractions • giant slides • obstacle courses • bounces\nFLAT RATE $9,000 • 1–4 DAYS\n\n⚓ PIRATE'S REBELLION\nA swashbuckling water/pirate themed adventure built for summer crowds.\nPirate boats • themed wet attractions • carnival games\nFLAT RATE $7,500 • 1–4 DAYS\n\n◎ WARRIOR'S PLAYGROUND\nAction Pursuit Gaming Arena for older kids, teens, and thrill seekers.\nPaintball • AirSoft • Orbeez (ammo extra) • 4 additional attractions\nFLAT RATE $7,500 • 1–4 DAYS\n\nEVERY PACKAGE INCLUDES\nComplete setup & teardown • supervisor & staffing • $2M insurance • professional operation\n\nBooking: (435) 760-5583\nTheAdventureZone12@gmail.com\nthe-adventure-zone.com`,
  },
  {
    id: "review-request",
    name: "Big Day Review Request",
    type: "review request",
    eyebrow: "THANKS FOR THE BIG DAY",
    headline: "How Did We Do?",
    description: "A branded organizer review card with cream background, navy frame, yellow star block, hot-pink accents, and a large QR/review call-to-action.",
    canvasSize: "1080 × 1080",
    accent: "navy",
    content: `THE ADVENTURE ZONE\n\nTHANKS FOR THE BIG DAY!\n\nHOW DID WE DO?\n★ ★ ★ ★ ★\n\nThanks for having us at [EVENT NAME]. Your feedback helps us recognize great leg managers, improve the experience, and make next year even better.\n\nSHARE YOUR EXPERIENCE\n[REVIEW LINK OR QR CODE]\n\nthe-adventure-zone.com`,
  },
];

export function starterByName(name?: string | null) {
  if (!name) return undefined;
  return CANVA_STARTERS.find((starter) => starter.name === name);
}
