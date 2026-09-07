import { z } from "zod";

import {
  isNormalizedPaperNoteRegion,
  type PaperNoteRegion,
} from "./paper-note-types";

export type PaperNoteWarning = {
  fieldPath: string;
  message: string;
  severity: "warning" | "blocking";
};

export type PaperNoteExtractedPhone = {
  number: string | null;
  extension: string | null;
  type: "mobile" | "office" | "alternate" | "unknown";
  label: string | null;
  instructions: string | null;
  crossedOut: boolean;
};

export type PaperNotePageSegmentation = {
  pageHeading: string | null;
  pageActivityDate: string | null;
  pageContext: string[];
  roughTranscription: string | null;
  entries: Array<{
    sourceOrder: number;
    region: PaperNoteRegion | null;
    roughText: string;
    mayContinue: boolean;
  }>;
};

export type PaperNoteExtraction = {
  source: "provider" | "manual";
  transcription: string;
  sourceRegion: PaperNoteRegion | null;
  mayContinue: boolean;
  event: {
    name: string | null;
    city: string | null;
    region: string | null;
    venue: string | null;
  };
  eventDates: Array<{
    rawText: string;
    startsOn: string | null;
    endsOn: string | null;
    derivedFromPageYear: boolean;
  }>;
  activity: {
    rawDateText: string | null;
    occurredOn: string | null;
    dateSource: "entry" | "page_heading" | "unknown";
    method: "call" | "email" | "mail" | "text" | "unknown";
    outcome: string | null;
    summary: string | null;
  };
  contacts: Array<{
    name: string | null;
    role: string | null;
    email: string | null;
    phones: PaperNoteExtractedPhone[];
  }>;
  organizationPhones: PaperNoteExtractedPhone[];
  oldReminder: string | null;
  starredOnPaper: boolean;
  generalNotes: string[];
  warnings: PaperNoteWarning[];
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneTypeSchema = z.enum(["mobile", "office", "alternate", "unknown"]);
const activityMethodSchema = z.enum(["call", "email", "mail", "text", "unknown"]);
const dateSourceSchema = z.enum(["entry", "page_heading", "unknown"]);

function nullableText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, maxLength);
  return text || null;
}

function requiredText(value: unknown, maxLength: number): string {
  return nullableText(value, maxLength) ?? "";
}

function jsonText(raw: string) {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(jsonText(raw));
  } catch {
    throw new Error("Paper note AI output was not valid JSON.");
  }
}

function normalizedDate(value: unknown): string | null {
  const text = nullableText(value, 20);
  return text && datePattern.test(text) ? text : null;
}

function normalizedRegion(value: unknown) {
  const text = nullableText(value, 24);
  return text ? text.toUpperCase() : null;
}

const segmentationSchema = z.object({
  pageHeading: z.unknown().optional(),
  pageActivityDate: z.unknown().optional(),
  pageContext: z.array(z.unknown()).max(20).optional().default([]),
  roughTranscription: z.unknown().optional(),
  entries: z.array(z.object({
    sourceOrder: z.number().int().nonnegative(),
    region: z.unknown().optional().nullable(),
    roughText: z.unknown().optional(),
    mayContinue: z.boolean().optional().default(false),
  })).max(80).optional().default([]),
});

function regionFrom(value: unknown): PaperNoteRegion | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PaperNoteRegion>;
  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number"
  ) return null;
  const region: PaperNoteRegion = {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
  return isNormalizedPaperNoteRegion(region) ? region : null;
}

export function parsePaperNotePageSegmentation(raw: string): PaperNotePageSegmentation {
  const parsed = segmentationSchema.safeParse(parseJson(raw));
  if (!parsed.success) throw new Error("Paper note segmentation output was malformed.");
  return {
    pageHeading: nullableText(parsed.data.pageHeading, 500),
    pageActivityDate: normalizedDate(parsed.data.pageActivityDate),
    pageContext: parsed.data.pageContext
      .flatMap((value) => nullableText(value, 500) ? [nullableText(value, 500)!] : [])
      .slice(0, 20),
    roughTranscription: nullableText(parsed.data.roughTranscription, 12_000),
    entries: parsed.data.entries
      .map((entry) => ({
        sourceOrder: entry.sourceOrder,
        region: regionFrom(entry.region),
        roughText: requiredText(entry.roughText, 4_000),
        mayContinue: entry.mayContinue,
      }))
      .sort((left, right) => left.sourceOrder - right.sourceOrder),
  };
}

const phoneSchema = z.object({
  number: z.unknown().optional().nullable(),
  extension: z.unknown().optional().nullable(),
  type: phoneTypeSchema.optional().default("unknown"),
  label: z.unknown().optional().nullable(),
  instructions: z.unknown().optional().nullable(),
  crossedOut: z.boolean().optional().default(false),
});

const entrySchema = z.object({
  transcription: z.unknown().optional(),
  sourceRegion: z.unknown().optional().nullable(),
  mayContinue: z.boolean().optional().default(false),
  event: z.object({
    name: z.unknown().optional().nullable(),
    city: z.unknown().optional().nullable(),
    region: z.unknown().optional().nullable(),
    venue: z.unknown().optional().nullable(),
  }).optional().default({}),
  eventDates: z.array(z.object({
    rawText: z.unknown().optional(),
    startsOn: z.unknown().optional().nullable(),
    endsOn: z.unknown().optional().nullable(),
    derivedFromPageYear: z.boolean().optional().default(false),
  })).max(10).optional().default([]),
  activity: z.object({
    rawDateText: z.unknown().optional().nullable(),
    occurredOn: z.unknown().optional().nullable(),
    dateSource: dateSourceSchema.optional().default("unknown"),
    method: activityMethodSchema.optional().default("unknown"),
    outcome: z.unknown().optional().nullable(),
    summary: z.unknown().optional().nullable(),
  }).optional().default({ dateSource: "unknown", method: "unknown" }),
  contacts: z.array(z.object({
    name: z.unknown().optional().nullable(),
    role: z.unknown().optional().nullable(),
    email: z.unknown().optional().nullable(),
    phones: z.array(phoneSchema).max(10).optional().default([]),
  })).max(20).optional().default([]),
  organizationPhones: z.array(phoneSchema).max(20).optional().default([]),
  oldReminder: z.unknown().optional().nullable(),
  starredOnPaper: z.boolean().optional().default(false),
  generalNotes: z.array(z.unknown()).max(30).optional().default([]),
});

function extractedPhone(
  input: z.infer<typeof phoneSchema>,
  path: string,
  warnings: PaperNoteWarning[],
): PaperNoteExtractedPhone {
  const number = nullableText(input.number, 80);
  const extension = nullableText(input.extension, 20);
  const digits = number?.replace(/\D/g, "") ?? "";
  if (number && (digits.length < 7 || digits.length > 15 || /[?x_]/i.test(number))) {
    warnings.push({
      fieldPath: `${path}.number`,
      message: "Phone number is partial or unreadable and must be checked against the paper.",
      severity: "blocking",
    });
  }
  if (extension && !/^\d{1,10}$/.test(extension)) {
    warnings.push({
      fieldPath: `${path}.extension`,
      message: "Phone extension needs review.",
      severity: "blocking",
    });
  }
  if (input.crossedOut) {
    warnings.push({
      fieldPath: path,
      message: "This phone was crossed out on the paper; no replacement or deactivation is automatic.",
      severity: "warning",
    });
  }
  return {
    number,
    extension,
    type: input.type,
    label: nullableText(input.label, 160),
    instructions: nullableText(input.instructions, 500),
    crossedOut: input.crossedOut,
  };
}

export function parsePaperNoteEntryExtraction(raw: string): PaperNoteExtraction {
  const parsed = entrySchema.safeParse(parseJson(raw));
  if (!parsed.success) throw new Error("Paper note entry output was malformed.");

  const warnings: PaperNoteWarning[] = [];
  const eventRegion = normalizedRegion(parsed.data.event.region);
  if (eventRegion && eventRegion.length !== 2) {
    warnings.push({
      fieldPath: "event.region",
      message: "State or region is not a two-letter state code.",
      severity: "warning",
    });
  }

  const eventDates = parsed.data.eventDates.map((eventDate, index) => {
    const rawStarts = nullableText(eventDate.startsOn, 20);
    const rawEnds = nullableText(eventDate.endsOn, 20);
    const startsOn = normalizedDate(eventDate.startsOn);
    const endsOn = normalizedDate(eventDate.endsOn);
    if (rawStarts && !startsOn) {
      warnings.push({
        fieldPath: `eventDates.${index}.startsOn`,
        message: "Event start date could not be parsed and needs review.",
        severity: "warning",
      });
    }
    if (rawEnds && !endsOn) {
      warnings.push({
        fieldPath: `eventDates.${index}.endsOn`,
        message: "Event end date could not be parsed and needs review.",
        severity: "warning",
      });
    }
    if (eventDate.derivedFromPageYear) {
      warnings.push({
        fieldPath: `eventDates.${index}.startsOn`,
        message: "The event year came from page context and must be confirmed during review.",
        severity: "warning",
      });
    }
    return {
      rawText: requiredText(eventDate.rawText, 200),
      startsOn,
      endsOn,
      derivedFromPageYear: eventDate.derivedFromPageYear,
    };
  });

  const rawOccurredOn = nullableText(parsed.data.activity.occurredOn, 20);
  const occurredOn = normalizedDate(parsed.data.activity.occurredOn);
  if (rawOccurredOn && !occurredOn) {
    warnings.push({
      fieldPath: "activity.occurredOn",
      message: "Historical activity date could not be parsed and needs review.",
      severity: "warning",
    });
  }

  const contacts = parsed.data.contacts.map((contact, contactIndex) => {
    const email = nullableText(contact.email, 320);
    if (email && !emailPattern.test(email)) {
      warnings.push({
        fieldPath: `contacts.${contactIndex}.email`,
        message: "Email address appears incomplete or unreadable.",
        severity: "blocking",
      });
    }
    return {
      name: nullableText(contact.name, 200),
      role: nullableText(contact.role, 200),
      email,
      phones: contact.phones.map((phone, phoneIndex) =>
        extractedPhone(phone, `contacts.${contactIndex}.phones.${phoneIndex}`, warnings)),
    };
  });

  const organizationPhones = parsed.data.organizationPhones.map((phone, phoneIndex) =>
    extractedPhone(phone, `organizationPhones.${phoneIndex}`, warnings));

  if (!nullableText(parsed.data.event.name, 300)) {
    warnings.push({
      fieldPath: "event.name",
      message: "No event or organization name was read from this entry.",
      severity: "blocking",
    });
  }

  return {
    source: "provider",
    transcription: requiredText(parsed.data.transcription, 12_000),
    sourceRegion: regionFrom(parsed.data.sourceRegion),
    mayContinue: parsed.data.mayContinue,
    event: {
      name: nullableText(parsed.data.event.name, 300),
      city: nullableText(parsed.data.event.city, 160),
      region: eventRegion,
      venue: nullableText(parsed.data.event.venue, 300),
    },
    eventDates,
    activity: {
      rawDateText: nullableText(parsed.data.activity.rawDateText, 200),
      occurredOn,
      dateSource: parsed.data.activity.dateSource,
      method: parsed.data.activity.method,
      outcome: nullableText(parsed.data.activity.outcome, 1_000),
      summary: nullableText(parsed.data.activity.summary, 4_000),
    },
    contacts,
    organizationPhones,
    oldReminder: nullableText(parsed.data.oldReminder, 1_000),
    starredOnPaper: parsed.data.starredOnPaper,
    generalNotes: parsed.data.generalNotes
      .flatMap((value) => nullableText(value, 1_000) ? [nullableText(value, 1_000)!] : [])
      .slice(0, 30),
    warnings,
  };
}

export function manualPaperNoteExtraction(transcription: string): PaperNoteExtraction {
  return {
    source: "manual",
    transcription: transcription.trim().slice(0, 12_000),
    sourceRegion: null,
    mayContinue: false,
    event: { name: null, city: null, region: null, venue: null },
    eventDates: [],
    activity: {
      rawDateText: null,
      occurredOn: null,
      dateSource: "unknown",
      method: "unknown",
      outcome: null,
      summary: null,
    },
    contacts: [],
    organizationPhones: [],
    oldReminder: null,
    starredOnPaper: false,
    generalNotes: [],
    warnings: [{
      fieldPath: "event.name",
      message: "Add the event or organization name during review.",
      severity: "blocking",
    }],
  };
}
