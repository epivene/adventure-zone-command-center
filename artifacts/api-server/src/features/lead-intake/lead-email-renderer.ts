import { approvedNormalPackageForKey } from "./lead-package-allowlist";

type PackageAvailability = {
  packages?: readonly { packageKey: string; availableQuantity: number }[];
  restrictedOptions?: readonly { packageKey: string; approvalRequired: true }[];
};

export type LeadEmailRenderInput = {
  profileName: string | null;
  eventName: string;
  eventCity: string | null;
  eventRegion: string | null;
  startDate: string;
  endDate: string;
  firstName: string | null;
  packageAvailability: PackageAvailability;
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEPT", "OCT", "NOV", "DEC"];

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("A verified ISO event date is required.");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatVerifiedDateRange(startDate: string, endDate: string) {
  const start = dateParts(startDate);
  const end = dateParts(endDate);
  const startLabel = `${MONTHS[start.month - 1]} ${start.day}`;
  const endLabel = `${MONTHS[end.month - 1]} ${end.day}`;
  if (start.year === end.year && start.month === end.month && start.day === end.day) return `${startLabel}, ${start.year}`;
  if (start.year === end.year) return `${startLabel} – ${endLabel}, ${end.year}`;
  return `${startLabel}, ${start.year} – ${endLabel}, ${end.year}`;
}

function available(input: PackageAvailability, ...keys: string[]) {
  const restricted = new Set(input.restrictedOptions?.map((option) => option.packageKey) ?? []);
  return input.packages?.some((item) =>
    keys.includes(item.packageKey) && approvedNormalPackageForKey(item.packageKey) !== null && item.availableQuantity > 0 && !restricted.has(item.packageKey),
  ) ?? false;
}

const packageCopy = {
  adventure_zone: `Our Adventure Zone units feature 10 amazing inflatable attractions, including thrilling obstacle courses, massive slides, interactive competitions, engaging carnival-style games, fun bouncy houses, and more. Check out this short video: Adventure Zone. We can offer our colorful attractions to your attendees for $9,000 (for 1-4 days).`,
  pirates_rebellion: `Release your inner Pirate in our Pirate’s Rebellion unit. We bring a massive inflatable pool and paddle-style boats where players can collect pirate coins while dodging sponges from other pirate ships. Two additional water/pirate-themed inflatable attractions and carnival-style games round out this all-water unit. Check out this short video: Pirate's Rebellion. This unit is available for $7,500 (for 1-4 days).`,
  weekend_warriors: `For the teenage crowd and thrill seekers, we invite you to try one of our Warrior’s Playground units. The all-star of this unit is our Action Pursuit Gaming Arena, where you can experience the adrenaline rush of Paintball, AirSoft, or Orbeez in a safe and regulated environment (ammo extra). This, plus four more exciting attractions, and carnival-style games round out this exciting unit. Check out our video here: Warrior’s Playground. This unit is available for $7,500 (for 1-4 days).`,
};

const includedServices = [
  "complete set-up and tear-down",
  "a supervisor and staffing for the entire event",
  "a certificate of insurance that lists you, the event holder, as additionally insured in a $2M policy",
  "a superb safety record entering our third decade",
  "a fun-filled, family-friendly environment, adding a level of amusement to your event",
];

export function renderLeadEmail(input: LeadEmailRenderInput) {
  const eventName = input.eventName.trim();
  const subjectName = input.profileName?.trim() || eventName;
  const city = input.eventCity?.trim();
  const region = input.eventRegion?.trim();
  const subject = [subjectName, city && `(${city})`, region, formatVerifiedDateRange(input.startDate, input.endDate)].filter(Boolean).join(" ");

  const sections = [
    input.firstName?.trim() ? `Hi, ${input.firstName.trim()}` : "Hi,",
    `My name is Desiree, and I work with Dave. We represent The Adventure Zone -- America's Best Inflatable Carnival! We’d love to come to your ${eventName}!`,
  ];
  if (available(input.packageAvailability, "adventure_zone")) sections.push(packageCopy.adventure_zone);
  if (available(input.packageAvailability, "pirates_rebellion", "pirate_rebellion")) sections.push(packageCopy.pirates_rebellion);
  if (available(input.packageAvailability, "weekend_warriors", "warriors_playground")) sections.push(packageCopy.weekend_warriors);

  const hasPackage = sections.length > 2;
  if (!hasPackage) throw new Error("No normal package is available for rendering.");
  sections.push(`Don’t forget, with every unit, we provide:\n\n${includedServices.map((item) => `- ${item}`).join("\n")}`);
  sections.push(input.eventCity?.trim()
    ? `We hope to join in your ${input.eventCity.trim()} celebration. Let us know how we can make that happen. If you have any questions, please let me know. We look forward to hearing from you and hope you have a phenomenal week. Take care,`
    : `We hope to join in your ${eventName} celebration. Let us know how we can make that happen. If you have any questions, please let me know. We look forward to hearing from you and hope you have a phenomenal week. Take care,`);
  sections.push("Desiree\nThe Adventure Zone\nPH: (435) 232-4281\nEMAIL: TheAdventureZone12@gmail.com\nWEB: https://www.the-adventure-zone.com/");
  return { subject, body: sections.join("\n\n") };
}
