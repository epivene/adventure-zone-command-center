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
    name: "Event Flyer Starter",
    type: "flyer",
    eyebrow: "FAMILY FUN IS COMING",
    headline: "Event Flyer",
    description: "A bold printable flyer for a fair, festival, celebration, or booked event.",
    canvasSize: "US Letter / Flyer",
    accent: "pink",
    content: `THE ADVENTURE ZONE\n\nFAMILY FUN IS COMING!\n\n[EVENT NAME]\n[DATE] • [TIME]\n[VENUE / CITY, STATE]\n\n10 ATTRACTIONS. ONE BIG ADVENTURE.\nMassive slides • obstacle courses • interactive games • bounce houses • carnival-style fun\n\nCOME PLAY WITH US!\nTickets / admission details: [ADD DETAILS]\n\nAmerica's Best Inflatable Bounce House Carnival\nthe-adventure-zone.com`,
  },
  {
    id: "social-post",
    name: "Social Post Starter",
    type: "social post",
    eyebrow: "WEEKEND PLANS?",
    headline: "Solved.",
    description: "A punchy event announcement sized for an Instagram or Facebook feed post.",
    canvasSize: "1080 × 1350",
    accent: "yellow",
    content: `THE ADVENTURE ZONE\n\nWEEKEND PLANS? SOLVED.\n\nFind us at [EVENT NAME]\n[DATE] • [CITY, STATE]\n\nSlides • Games • Challenges • Bounce\n\nBRING THE WHOLE CREW →`,
  },
  {
    id: "last-minute-booking",
    name: "Last-Minute Booking Promo",
    type: "social post",
    eyebrow: "OPEN DATE ALERT",
    headline: "Need family fun fast?",
    description: "Use when a leg has an unexpected opening and you want to find a nearby event quickly.",
    canvasSize: "1080 × 1350",
    accent: "orange",
    content: `THE ADVENTURE ZONE • OPEN DATE ALERT\n\nNEED FAMILY FUN FAST?\n\nWe have an opening near [REGION / ROUTE] for:\n[AVAILABLE DATE]\n\nA complete staffed attraction area\nSet-up • tear-down • supervisor • staffing • insured • family-friendly\n\nPerfect for fairs, festivals, community celebrations & special events.\n\nBooking: (435) 760-5583\nTheAdventureZone12@gmail.com`,
  },
  {
    id: "package-overview",
    name: "Package Overview One-Sheet",
    type: "brochure",
    eyebrow: "3 WAYS TO BRING THE FUN",
    headline: "Package Overview",
    description: "A simple one-page visual explaining Adventure Zone, Pirate's Rebellion, and Warrior's Playground.",
    canvasSize: "US Letter",
    accent: "blue",
    content: `THE ADVENTURE ZONE\n3 WAYS TO BRING THE FUN\nChoose the package that fits your event.\n\nADVENTURE ZONE\n10 inflatable attractions: slides, obstacle courses, interactive competitions, games and bounce houses.\n$9,000 • 1–4 days\n\nPIRATE'S REBELLION\nWater & pirate-themed fun with paddle-style pirate boats, themed inflatables and carnival-style games.\n$7,500 • 1–4 days\n\nWARRIOR'S PLAYGROUND\nAction Pursuit Gaming Arena with Paintball, AirSoft or Orbeez (ammo extra), plus four attractions and games.\n$7,500 • 1–4 days\n\nEvery package includes complete set-up and tear-down, supervisor and staffing, a $2M insurance certificate, and a family-friendly staffed entertainment area.\n\nBooking: (435) 760-5583\nTheAdventureZone12@gmail.com\nthe-adventure-zone.com`,
  },
  {
    id: "review-request",
    name: "Event Review Request Graphic",
    type: "review request",
    eyebrow: "HOW DID WE DO?",
    headline: "★★★★★",
    description: "A clean follow-up graphic for event organizers to rate their Adventure Zone experience.",
    canvasSize: "1080 × 1080",
    accent: "navy",
    content: `THE ADVENTURE ZONE\n\nHOW DID WE DO?\n★★★★★\n\nThanks for having us at [EVENT NAME]. Your feedback helps us recognize great leg managers, improve the experience, and make next year even better.\n\nSCAN / CLICK TO REVIEW\n[REVIEW LINK OR QR CODE]`,
  },
];

export function starterByName(name?: string | null) {
  if (!name) return undefined;
  return CANVA_STARTERS.find((starter) => starter.name === name);
}
