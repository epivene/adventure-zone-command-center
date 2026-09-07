import type { OperationalPackageKey } from "./david-calendar-parser";

export type ConfirmedBookingProjection = {
  managerName: string;
  eventName: string;
  city: string;
  region: string;
  actualEventDateText: string;
  reservedStart: Date;
  reservedEnd: Date;
  packages: ReadonlyArray<Exclude<OperationalPackageKey, "unknown">>;
  contactText?: string | null;
  addressText?: string | null;
  attractionText?: string | null;
  additionalInfo?: string | null;
  paymentInfo?: string | null;
  invoiceSent?: string | null;
  contractSigned?: string | null;
  depositReceived?: string | null;
  amountDue?: string | null;
};

export type RenderedOperationalCalendarRow = {
  packageKey: Exclude<OperationalPackageKey, "unknown">;
  summary: string;
  description: string;
  reservedStart: Date;
  reservedEnd: Date;
};

const packageLabel: Record<RenderedOperationalCalendarRow["packageKey"], string> = {
  zone: "Zone",
  pirates: "Pirates",
  warrior: "Warrior",
};

function append(lines: string[], label: string, value: string | null | undefined) {
  const clean = value?.trim();
  if (clean) lines.push(`${label}: ${clean}`);
}

export function renderOperationalCalendarRows(
  input: ConfirmedBookingProjection,
): RenderedOperationalCalendarRow[] {
  const manager = input.managerName.trim().toUpperCase();
  const base = `${manager} ${input.eventName.trim()} - ${input.city.trim()} ${input.region.trim().toUpperCase()}`;
  const description: string[] = [];
  append(description, "CONTACT", input.contactText);
  append(description, "EVENT DATES", input.actualEventDateText);
  append(description, "EVENT ADDRESS/MAILING", input.addressText);
  append(description, "ATTRACTION LIST", input.attractionText);
  append(description, "ADDITIONAL INFO", input.additionalInfo);
  append(description, "PAYMENT INFO", input.paymentInfo);
  append(description, "INVOICE SENT", input.invoiceSent);
  append(description, "CONTRACT SIGNED", input.contractSigned);
  append(description, "DEPOSIT RECEIVED", input.depositReceived);
  append(description, "AMOUNT DUE UPON ARRIVAL", input.amountDue);

  return input.packages.map((packageKey) => ({
    packageKey,
    summary: `${base} (${packageLabel[packageKey]})`,
    description: description.join("\n"),
    reservedStart: input.reservedStart,
    reservedEnd: input.reservedEnd,
  }));
}
