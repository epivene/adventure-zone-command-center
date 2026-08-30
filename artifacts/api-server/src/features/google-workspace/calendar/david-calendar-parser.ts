export type OperationalPackageKey = "zone" | "pirates" | "warrior" | "unknown";
export type OperationalCalendarState =
  | "confirmed"
  | "placeholder"
  | "cancelled"
  | "action_required"
  | "non_event";

export type ParsedOperationalCalendarEvent = {
  managerToken: string | null;
  eventName: string;
  city: string | null;
  region: string | null;
  packageKey: OperationalPackageKey;
  calendarState: OperationalCalendarState;
  actualEventDateText: string | null;
  contactText: string | null;
  addressText: string | null;
  attractionText: string | null;
  additionalInfo: string | null;
  paymentInfo: string | null;
  invoiceSent: string | null;
  contractSigned: string | null;
  depositReceived: string | null;
  amountDue: string | null;
  originalDescription: string | null;
};

const actionPrefixes = [
  "NEED CONTACT",
  "NEED CONTACT & PH",
  "NEED CONTACT AND PH",
  "CONTACT ",
  "FIND ",
  "FOLLOW-UP",
  "FOLLOW UP",
];

const nonEventPrefixes = [
  "PERSONAL",
  "PRIVATE",
  "BLOCKED",
  "OUT OF OFFICE",
  "OOO",
  "VACATION",
  "TRAVEL",
  "DRIVE",
  "DRIVING",
  "BIRTHDAY",
];

function packageKey(value: string | null): OperationalPackageKey {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("zone")) return "zone";
  if (normalized.includes("pirate")) return "pirates";
  if (normalized.includes("warrior")) return "warrior";
  return "unknown";
}

function calendarState(summary: string): OperationalCalendarState {
  const upper = summary.trim().toUpperCase();
  if (upper.startsWith("CANCELLED") || upper.startsWith("CANCELED")) return "cancelled";
  if (upper.startsWith("PLACEHOLDER")) return "placeholder";
  if (actionPrefixes.some((prefix) => upper.startsWith(prefix))) return "action_required";
  if (nonEventPrefixes.some((prefix) => upper === prefix || upper.startsWith(`${prefix} `) || upper.startsWith(`${prefix}:`))) {
    return "non_event";
  }
  return "confirmed";
}

function stripStatePrefix(summary: string) {
  return summary
    .replace(/^CANCELLED\s+/i, "")
    .replace(/^CANCELED\s+/i, "")
    .replace(/^PLACEHOLDER\s+/i, "")
    .trim();
}

function parseTitle(summary: string) {
  const state = calendarState(summary);
  const cleaned = stripStatePrefix(summary);
  const packageMatch = cleaned.match(/\(([^)]+)\)\s*$/);
  const packageText = packageMatch?.[1] ?? null;
  const withoutPackage = packageMatch ? cleaned.slice(0, packageMatch.index).trim() : cleaned;

  const managerMatch = withoutPackage.match(/^([A-Z][A-Z0-9]*)\s+(.+)$/);
  const managerToken = state === "confirmed" && managerMatch ? managerMatch[1]! : null;
  const body = managerToken && managerMatch ? managerMatch[2]!.trim() : withoutPackage;

  const locationMatch = body.match(/^(.*?)\s+-\s+(.+?)\s+([A-Z]{2})\s*$/);
  if (!locationMatch) {
    return {
      managerToken,
      eventName: body.trim(),
      city: null,
      region: null,
      packageKey: packageKey(packageText),
      calendarState: state,
    };
  }

  return {
    managerToken,
    eventName: locationMatch[1]!.trim(),
    city: locationMatch[2]!.trim(),
    region: locationMatch[3]!.toUpperCase(),
    packageKey: packageKey(packageText),
    calendarState: state,
  };
}

const labelMap = {
  "CONTACT": "contactText",
  "EVENT DATES": "actualEventDateText",
  "EVENT ADDRESS/MAILING": "addressText",
  "EVENT ADDRESS / MAILING": "addressText",
  "EVENT ADDRESS": "addressText",
  "ATTRACTION LIST": "attractionText",
  "ADDITIONAL INFO": "additionalInfo",
  "PAYMENT INFO": "paymentInfo",
  "INVOICE SENT": "invoiceSent",
  "CONTRACT SIGNED": "contractSigned",
  "DEPOSIT RECEIVED": "depositReceived",
  "AMOUNT DUE UPON ARRIVAL": "amountDue",
} as const;

type ParsedLabelKey = (typeof labelMap)[keyof typeof labelMap];

function parseDescription(description: string | null | undefined) {
  const values: Record<ParsedLabelKey, string | null> = {
    actualEventDateText: null,
    contactText: null,
    addressText: null,
    attractionText: null,
    additionalInfo: null,
    paymentInfo: null,
    invoiceSent: null,
    contractSigned: null,
    depositReceived: null,
    amountDue: null,
  };
  if (!description?.trim()) return values;

  const lines = description.replace(/\r\n/g, "\n").split("\n");
  let activeKey: ParsedLabelKey | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const label = Object.keys(labelMap).find((candidate) =>
      line.toUpperCase() === candidate || line.toUpperCase().startsWith(`${candidate}:`),
    ) as keyof typeof labelMap | undefined;
    if (label) {
      activeKey = labelMap[label];
      const sameLine = line.slice(label.length).replace(/^\s*:\s*/, "").trim();
      values[activeKey] = sameLine || null;
      continue;
    }
    if (activeKey && line) {
      values[activeKey] = values[activeKey] ? `${values[activeKey]}\n${line}` : line;
    }
  }
  return values;
}

export function parseDavidOperationalCalendarEvent(input: {
  summary: string;
  description?: string | null;
}): ParsedOperationalCalendarEvent {
  const title = parseTitle(input.summary);
  const description = parseDescription(input.description);
  return {
    ...title,
    ...description,
    originalDescription: input.description ?? null,
  };
}
