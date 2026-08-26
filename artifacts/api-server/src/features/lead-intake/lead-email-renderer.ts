import { approvedNormalPackageForKey } from "./lead-package-allowlist";
import { APPROVED_LEAD_INTRODUCTION_2026, type ApprovedLeadIntroductionDefinition } from "../communication-templates/lead-introduction-2026-approved";

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

export function renderLeadEmail(input: LeadEmailRenderInput, definition: ApprovedLeadIntroductionDefinition = APPROVED_LEAD_INTRODUCTION_2026) {
  const eventName = input.eventName.trim();
  const subjectName = input.profileName?.trim() || eventName;
  const city = input.eventCity?.trim();
  const region = input.eventRegion?.trim();
  const subject = [subjectName, city && `(${city})`, region, formatVerifiedDateRange(input.startDate, input.endDate)].filter(Boolean).join(" ");

  const sections = [
    input.firstName?.trim() ? `Hi, ${input.firstName.trim()}` : "Hi,",
    definition.opening.replace("{{eventName}}", eventName),
  ];
  if (available(input.packageAvailability, "adventure_zone")) sections.push(definition.packages.adventure_zone);
  if (available(input.packageAvailability, "pirates_rebellion", "pirate_rebellion")) sections.push(definition.packages.pirates_rebellion);
  if (available(input.packageAvailability, "weekend_warriors", "warriors_playground")) sections.push(definition.packages.weekend_warriors);

  const hasPackage = sections.length > 2;
  if (!hasPackage) throw new Error("No normal package is available for rendering.");
  sections.push(`Don’t forget, with every unit, we provide:\n\n${definition.services.map((item) => `- ${item}`).join("\n")}`);
  sections.push(input.eventCity?.trim()
    ? `We hope to join in your ${input.eventCity.trim()} celebration. ${definition.closing}`
    : `We hope to join in your ${eventName} celebration. ${definition.closing}`);
  sections.push(definition.signature);
  return { subject, body: sections.join("\n\n") };
}
