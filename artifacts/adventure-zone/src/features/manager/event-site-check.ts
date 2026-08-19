export const eventSiteCheckItems = [
  ["contactCommunication", "Contact communication was good"],
  ["onsiteContactAvailable", "On-site contact was easy to reach"],
  ["locationAccurate", "Location/address was accurate"],
  ["setupAccessAccurate", "Setup area and access matched expectations"],
  ["restroomsAvailable", "Restrooms available"],
  ["showersAvailable", "Showers available"],
  ["powerAvailable", "Power available"],
  ["generatorAvailable", "Generator available"],
  ["waterAvailable", "Water/hose available"],
  ["forkliftAvailable", "Forklift/loader available"],
  ["teardownAccessGood", "Teardown access was good"],
  ["anchoringWorked", "Staking/anchoring worked for the site"],
  ["groundConditionsGood", "Ground/site conditions were good"],
  ["crewFacilitiesGood", "Crew facilities were adequate"],
] as const;

export type EventSiteCheckKey = (typeof eventSiteCheckItems)[number][0];
export type ReturnRecommendation = "yes" | "unsure" | "no" | "";

export type EventSiteCheck = Record<EventSiteCheckKey, boolean> & {
  eventNotes: string;
  followUpNotes: string;
  highlights: string;
  recommendReturn: ReturnRecommendation;
};

export const emptyEventSiteCheck = (): EventSiteCheck => ({
  contactCommunication: false,
  onsiteContactAvailable: false,
  locationAccurate: false,
  setupAccessAccurate: false,
  restroomsAvailable: false,
  showersAvailable: false,
  powerAvailable: false,
  generatorAvailable: false,
  waterAvailable: false,
  forkliftAvailable: false,
  teardownAccessGood: false,
  anchoringWorked: false,
  groundConditionsGood: false,
  crewFacilitiesGood: false,
  eventNotes: "",
  followUpNotes: "",
  highlights: "",
  recommendReturn: "",
});

const START = "[Event site check]";
const END = "[/Event site check]";

function encode(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function decode(value: string) {
  return value.replaceAll("\\n", "\n").replaceAll("\\\\", "\\");
}

export function serializeEventSiteCheck(siteCheck: EventSiteCheck, ratingNotes: string) {
  const lines = [START];
  for (const [key, label] of eventSiteCheckItems) {
    lines.push(`- [${siteCheck[key] ? "x" : " "}] ${label}`);
  }
  lines.push(`Return recommendation: ${siteCheck.recommendReturn || "not set"}`);
  lines.push(`Event notes: ${encode(siteCheck.eventNotes.trim())}`);
  lines.push(`Follow-up notes: ${encode(siteCheck.followUpNotes.trim())}`);
  lines.push(`Highlights: ${encode(siteCheck.highlights.trim())}`);
  lines.push(END);
  const trimmedNotes = ratingNotes.trim();
  return trimmedNotes ? `${lines.join("\n")}\n\n${trimmedNotes}` : lines.join("\n");
}

export function parseEventSiteCheck(value: string | null | undefined): { siteCheck: EventSiteCheck; ratingNotes: string } {
  const source = value ?? "";
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start) return { siteCheck: emptyEventSiteCheck(), ratingNotes: source };

  const block = source.slice(start + START.length, end).trim();
  const siteCheck = emptyEventSiteCheck();
  for (const [key, label] of eventSiteCheckItems) {
    const checked = block.includes(`- [x] ${label}`);
    siteCheck[key] = checked;
  }

  for (const line of block.split("\n")) {
    if (line.startsWith("Return recommendation: ")) {
      const recommendation = line.slice("Return recommendation: ".length).trim();
      siteCheck.recommendReturn = recommendation === "yes" || recommendation === "unsure" || recommendation === "no" ? recommendation : "";
    } else if (line.startsWith("Event notes: ")) {
      siteCheck.eventNotes = decode(line.slice("Event notes: ".length));
    } else if (line.startsWith("Follow-up notes: ")) {
      siteCheck.followUpNotes = decode(line.slice("Follow-up notes: ".length));
    } else if (line.startsWith("Highlights: ")) {
      siteCheck.highlights = decode(line.slice("Highlights: ".length));
    }
  }

  const before = source.slice(0, start).trim();
  const after = source.slice(end + END.length).trim();
  return { siteCheck, ratingNotes: [before, after].filter(Boolean).join("\n\n") };
}
