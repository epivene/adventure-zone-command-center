import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  auditEntries,
  activities,
  activityAssociations,
  bookings,
  callingListMemberships,
  callingLists,
  contacts,
  followUps,
  organizationContacts,
  organizationLocations,
  organizations,
} from "@/db/schema";
import {
  activeOrganizationContactCondition,
  organizationOwnedRecordCondition,
} from "@/features/organizations/organization-repository";

export type EventProfilePlace = {
  id: string;
  name: string;
  placeType: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  lastResort: boolean;
  lastResortReason: string | null;
  actRecordId: string | null;
};

export type EventProfileContactRecord = {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
  source: string;
  actRecordId: string | null;
  locationName: string | null;
  locationCity: string | null;
  locationRegion: string | null;
};

export type EventProfileBookingRecord = {
  id: string;
  name: string;
  primaryContactId: string | null;
  city: string;
  region: string;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  probability: string;
  notes: string | null;
  actRecordId: string | null;
};

export type EventProfileActivityRecord = {
  id: string;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  subject?: string | null;
  body: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  importedFromAct: boolean;
  actSourceType: string | null;
  historicalDateUnknown?: boolean;
  paperNoteSource?: { activityId: string } | null;
};

export type EventProfileScoutNoteSource = {
  url: string;
  title: string;
  publisher: string | null;
  category: string;
  retrievedAt: string;
};

export type EventProfileScoutNote = {
  id: string;
  occurredAt: Date;
  runId: string;
  candidateId: string;
  createdAt: string;
  originalQuestion: string;
  criteriaSummary: string | null;
  fitScore: number | null;
  summary: string;
  positives: string[];
  cautions: string[];
  coverageGaps: string[];
  suggestedNextAction: {
    kind: "call" | "email" | "prepare_quote";
    dueAt: string;
  };
  sources: EventProfileScoutNoteSource[];
};

export type EventProfileFollowUpRecord = {
  id: string;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
};

export type EventProfileGroupRecord = {
  id: string;
  name: string;
  kind: string;
  source: string;
  sourceStatus: string;
  actRecordId: string | null;
};

export type EventProfileSourceReference = {
  entityType: "organization" | "contact" | "booking" | "calling_list";
  entityId: string;
  sourceEntityType: string;
  actRecordId: string;
  isPrimary: boolean;
  syncMode: string;
};

export type EventProfileRecordSet = {
  place: EventProfilePlace;
  contacts: EventProfileContactRecord[];
  bookings: EventProfileBookingRecord[];
  activities: EventProfileActivityRecord[];
  followUps: EventProfileFollowUpRecord[];
  groups: EventProfileGroupRecord[];
  externalLinks: EventProfileSourceReference[];
};

export type EventProfileContact = Omit<EventProfileContactRecord, "firstName" | "lastName"> & {
  name: string;
};

export type EventProfile = {
  id: string;
  place: EventProfilePlace;
  contacts: EventProfileContact[];
  selectedContactId: string | null;
  bookings: EventProfileBookingRecord[];
  notes: EventProfileActivityRecord[];
  scoutNotes: EventProfileScoutNote[];
  history: EventProfileActivityRecord[];
  followUps: EventProfileFollowUpRecord[];
  groups: EventProfileGroupRecord[];
  sourceProvenance: EventProfileSourceReference[];
  migrationHistory?: {
    contactSourceIds: string[];
    phones: string[];
    notes: string[];
    bookingSourceIds: string[];
    groupSourceIds: string[];
  };
};

export interface EventProfileRepository {
  getEventProfile(
    profileId: string,
    selectedContactId?: string,
  ): Promise<EventProfile | null>;
}

function contactOrder(left: EventProfileContactRecord, right: EventProfileContactRecord) {
  return Number(right.isPrimary) - Number(left.isPrimary)
    || (left.role ?? "").localeCompare(right.role ?? "")
    || left.lastName.localeCompare(right.lastName)
    || left.firstName.localeCompare(right.firstName)
    || left.id.localeCompare(right.id);
}


type CanonicalProfileContact = EventProfileContact & {
  sourceContactIds: string[];
};

type CanonicalProfileBookingSelection = {
  bookings: EventProfileBookingRecord[];
  canonicalBookingIds: Map<string, string>;
};

function normalizedIdentityPart(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "") ?? "";
}

function normalizedContactEmail(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function normalizedContactPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function contactsShareIdentity(left: EventProfileContact, right: EventProfileContact) {
  const leftName = normalizedIdentityPart(left.name);
  const rightName = normalizedIdentityPart(right.name);
  if (!leftName || leftName !== rightName) return false;

  const leftEmail = normalizedContactEmail(left.email);
  const rightEmail = normalizedContactEmail(right.email);
  if (leftEmail && rightEmail && leftEmail === rightEmail) return true;

  const leftPhone = normalizedContactPhone(left.phone);
  const rightPhone = normalizedContactPhone(right.phone);
  return Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
}

function mergeCanonicalContact(
  canonical: CanonicalProfileContact,
  contact: EventProfileContact,
  sourceContactIds: readonly string[] = [contact.id],
) {
  for (const sourceContactId of sourceContactIds) {
    if (!canonical.sourceContactIds.includes(sourceContactId)) canonical.sourceContactIds.push(sourceContactId);
  }
  canonical.isPrimary ||= contact.isPrimary;
  canonical.role ||= contact.role;
  canonical.phone ||= contact.phone;
  canonical.email ||= contact.email;
  canonical.actRecordId ||= contact.actRecordId;
  canonical.locationName ||= contact.locationName;
  canonical.locationCity ||= contact.locationCity;
  canonical.locationRegion ||= contact.locationRegion;
}

function canonicalProfileContacts(records: EventProfileContactRecord[]) {
  const groups: CanonicalProfileContact[] = [];

  for (const record of records.toSorted(contactOrder)) {
    const contact: EventProfileContact = {
      id: record.id,
      name: `${record.firstName} ${record.lastName}`.trim(),
      role: record.role,
      isPrimary: record.isPrimary,
      phone: record.phone,
      email: record.email,
      source: record.source,
      actRecordId: record.actRecordId,
      locationName: record.locationName,
      locationCity: record.locationCity,
      locationRegion: record.locationRegion,
    };

    const matchingIndexes = groups
      .map((group, index) => contactsShareIdentity(group, contact) ? index : -1)
      .filter((index) => index >= 0);

    if (matchingIndexes.length === 0) {
      groups.push({ ...contact, sourceContactIds: [contact.id] });
      continue;
    }

    const canonical = groups[matchingIndexes[0]!]!;
    mergeCanonicalContact(canonical, contact);
    for (const index of matchingIndexes.slice(1).toSorted((left, right) => right - left)) {
      const merged = groups[index]!;
      mergeCanonicalContact(canonical, merged, merged.sourceContactIds);
      groups.splice(index, 1);
    }
  }

  return groups;
}

const mergedBookingNotePattern = /^\s*\[Merged duplicate\]\s*Canonical booking:\s*([0-9a-f-]{36})/i;

function exactBookingKey(booking: EventProfileBookingRecord) {
  if (!booking.startsAt) return `booking:${booking.id}`;
  return [
    normalizedIdentityPart(booking.name),
    normalizedIdentityPart(booking.city),
    normalizedIdentityPart(booking.region),
    booking.startsAt.toISOString(),
    booking.endsAt?.toISOString() ?? "",
  ].join("\u0000");
}

function appearanceScore(booking: EventProfileBookingRecord, namedCanonicalIds: Set<string>) {
  return (namedCanonicalIds.has(booking.id.toLowerCase()) ? 1_000 : 0)
    + (booking.startsAt ? 100 : 0)
    + (booking.endsAt ? 20 : 0)
    + (booking.actRecordId ? 5 : 0);
}

function canonicalProfileBookings(records: EventProfileBookingRecord[]): CanonicalProfileBookingSelection {
  const namedCanonicalIds = new Set<string>();
  const canonicalBookingIds = new Map<string, string>();
  for (const booking of records) {
    const canonicalId = booking.notes?.match(mergedBookingNotePattern)?.[1];
    if (!canonicalId) continue;
    namedCanonicalIds.add(canonicalId.toLowerCase());
    canonicalBookingIds.set(booking.id, canonicalId.toLowerCase());
  }

  const selected = new Map<string, EventProfileBookingRecord>();
  for (const booking of records) {
    if (mergedBookingNotePattern.test(booking.notes ?? "")) continue;
    const key = exactBookingKey(booking);
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, booking);
      continue;
    }

    const candidateScore = appearanceScore(booking, namedCanonicalIds);
    const existingScore = appearanceScore(existing, namedCanonicalIds);
    if (candidateScore > existingScore || (candidateScore === existingScore && booking.id < existing.id)) {
      canonicalBookingIds.set(existing.id, booking.id);
      selected.set(key, booking);
    } else {
      canonicalBookingIds.set(booking.id, existing.id);
    }
  }

  return {
    bookings: [...selected.values()].toSorted((left, right) =>
      Number(right.startsAt ?? 0) - Number(left.startsAt ?? 0)
      || left.name.localeCompare(right.name)
      || left.id.localeCompare(right.id),
    ),
    canonicalBookingIds,
  };
}

function canonicalRecordId(mapping: ReadonlyMap<string, string>, id: string | null) {
  if (!id) return null;
  let current = id;
  const seen = new Set<string>();
  while (mapping.has(current) && !seen.has(current)) {
    seen.add(current);
    current = mapping.get(current)!;
  }
  return current;
}

function sourceReference(
  entityType: EventProfileSourceReference["entityType"],
  entityId: string,
  sourceEntityType: string,
  actRecordId: string | null,
): EventProfileSourceReference[] {
  return actRecordId ? [{
    entityType,
    entityId,
    sourceEntityType,
    actRecordId,
    isPrimary: true,
    syncMode: "pull_only",
  }] : [];
}

function stableSourceProvenance(records: EventProfileRecordSet) {
  const legacyReferences = [
    ...sourceReference("organization", records.place.id, "company", records.place.actRecordId),
    ...records.contacts.flatMap((contact) => sourceReference("contact", contact.id, "contact", contact.actRecordId)),
    ...records.bookings.flatMap((booking) => sourceReference("booking", booking.id, "opportunity", booking.actRecordId)),
    ...records.groups.flatMap((group) => sourceReference("calling_list", group.id, "group", group.actRecordId)),
  ];
  const unique = new Map<string, EventProfileSourceReference>();
  for (const reference of [...legacyReferences, ...records.externalLinks]) {
    unique.set(
      `${reference.entityType}:${reference.entityId}:${reference.sourceEntityType}:${reference.actRecordId}`,
      reference,
    );
  }
  return [...unique.values()].toSorted((left, right) =>
    left.entityType.localeCompare(right.entityType)
    || left.entityId.localeCompare(right.entityId)
    || left.sourceEntityType.localeCompare(right.sourceEntityType)
    || left.actRecordId.localeCompare(right.actRecordId),
  );
}

function visibleActivityText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeImportedActActivities(records: EventProfileActivityRecord[]) {
  const seen = new Set<string>();
  return records
    .toSorted((left, right) =>
      Number(right.occurredAt) - Number(left.occurredAt) || left.id.localeCompare(right.id),
    )
    .filter((activity) => {
      if (!activity.importedFromAct) return true;
      const body = visibleActivityText(activity.body);
      if (!body) return true;
      const key = `${activity.occurredAt.getTime()}\u0000${body}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function safePublicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function parseScoutSource(value: unknown): EventProfileScoutNoteSource | null {
  if (!isRecord(value)) return null;
  const url = safePublicUrl(value.url);
  if (!url || typeof value.title !== "string") return null;
  return {
    url,
    title: value.title.trim() || url,
    publisher: typeof value.publisher === "string" ? value.publisher : null,
    category: typeof value.category === "string" ? value.category : "other",
    retrievedAt: typeof value.retrievedAt === "string" ? value.retrievedAt : "",
  };
}

function parseScoutNote(activity: EventProfileActivityRecord): EventProfileScoutNote | null {
  if (activity.kind !== "approved_suggestion" || activity.subject !== "Scout Notes") return null;
  try {
    const value: unknown = JSON.parse(activity.body);
    if (!isRecord(value) || value.type !== "scout_note" || value.version !== 1) return null;
    if (
      typeof value.runId !== "string"
      || typeof value.candidateId !== "string"
      || typeof value.createdAt !== "string"
      || typeof value.originalQuestion !== "string"
      || typeof value.summary !== "string"
      || !isRecord(value.suggestedNextAction)
      || !["call", "email", "prepare_quote"].includes(String(value.suggestedNextAction.kind))
      || typeof value.suggestedNextAction.dueAt !== "string"
    ) return null;

    const actionKind = value.suggestedNextAction.kind as EventProfileScoutNote["suggestedNextAction"]["kind"];
    return {
      id: activity.id,
      occurredAt: activity.occurredAt,
      runId: value.runId,
      candidateId: value.candidateId,
      createdAt: value.createdAt,
      originalQuestion: value.originalQuestion,
      criteriaSummary: typeof value.criteriaSummary === "string" ? value.criteriaSummary : null,
      fitScore: typeof value.fitScore === "number" && Number.isFinite(value.fitScore) ? value.fitScore : null,
      summary: value.summary,
      positives: stringList(value.positives),
      cautions: stringList(value.cautions),
      coverageGaps: stringList(value.coverageGaps),
      suggestedNextAction: {
        kind: actionKind,
        dueAt: value.suggestedNextAction.dueAt,
      },
      sources: Array.isArray(value.sources)
        ? value.sources.map(parseScoutSource).filter((source): source is EventProfileScoutNoteSource => Boolean(source))
        : [],
    };
  } catch {
    return null;
  }
}

const PROFILE_ACTIVITY_LIMIT = 100;

function splitProfileActivities(records: EventProfileActivityRecord[]) {
  const activities = dedupeImportedActActivities(records).slice(0, PROFILE_ACTIVITY_LIMIT);
  const scoutNotes = activities
    .map(parseScoutNote)
    .filter((note): note is EventProfileScoutNote => Boolean(note));
  const scoutActivityIds = new Set(scoutNotes.map((note) => note.id));
  return {
    notes: activities.filter((activity) =>
      !scoutActivityIds.has(activity.id)
      && (
        !activity.importedFromAct
        || activity.actSourceType === "note"
        || activity.actSourceType === "paper_note"
        || activity.actSourceType == null
      ),
    ),
    scoutNotes,
    history: activities.filter((activity) =>
      activity.importedFromAct
      && (activity.actSourceType === "history" || activity.actSourceType === "activity"),
    ),
  };
}

export function buildEventProfile(
  records: EventProfileRecordSet,
  requestedContactId?: string,
  migrationHistory: EventProfile["migrationHistory"] = {
    contactSourceIds: [], phones: [], notes: [], bookingSourceIds: [], groupSourceIds: [],
  },
): EventProfile {
  const contactGroups = canonicalProfileContacts(records.contacts);
  const contactIdMap = new Map<string, string>();
  for (const contact of contactGroups) {
    for (const sourceContactId of contact.sourceContactIds) contactIdMap.set(sourceContactId, contact.id);
  }
  const requestedContactGroup = contactGroups.find((contact) =>
    requestedContactId ? contact.sourceContactIds.includes(requestedContactId) : false,
  );
  const contacts = contactGroups.map(({ sourceContactIds: _sourceContactIds, ...contact }) => contact);
  const selectedContactId = requestedContactGroup?.id ?? contacts[0]?.id ?? null;

  const bookingSelection = canonicalProfileBookings(records.bookings);
  const timeline = splitProfileActivities(records.activities.map((activity) => ({
    ...activity,
    contactId: canonicalRecordId(contactIdMap, activity.contactId),
    bookingId: canonicalRecordId(bookingSelection.canonicalBookingIds, activity.bookingId),
  })));

  return {
    id: records.place.id,
    place: records.place,
    contacts,
    selectedContactId,
    bookings: bookingSelection.bookings.map((booking) => ({
      ...booking,
      primaryContactId: canonicalRecordId(contactIdMap, booking.primaryContactId),
    })),
    notes: timeline.notes,
    scoutNotes: timeline.scoutNotes,
    history: timeline.history,
    followUps: records.followUps
      .map((followUp) => ({
        ...followUp,
        contactId: canonicalRecordId(contactIdMap, followUp.contactId),
        bookingId: canonicalRecordId(bookingSelection.canonicalBookingIds, followUp.bookingId),
      }))
      .toSorted((left, right) =>
        Number(left.completedAt !== null) - Number(right.completedAt !== null)
        || Number(left.dueAt) - Number(right.dueAt)
        || left.id.localeCompare(right.id),
      ),
    groups: records.groups.toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    sourceProvenance: stableSourceProvenance(records),
    migrationHistory,
  };
}

type DrizzleDatabase = typeof database;

export class DrizzleEventProfileRepository implements EventProfileRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async getEventProfile(profileId: string, selectedContactId?: string): Promise<EventProfile | null> {
    const [place] = await this.database.select({
      id: organizations.id,
      name: organizations.name,
      placeType: organizations.placeType,
      phone: organizations.phone,
      address1: organizations.address1,
      address2: organizations.address2,
      city: organizations.city,
      region: organizations.region,
      postalCode: organizations.postalCode,
      website: organizations.website,
      lastResort: organizations.lastResort,
      lastResortReason: organizations.lastResortReason,
      actRecordId: organizations.actRecordId,
    }).from(organizations).where(eq(organizations.id, profileId)).limit(1);
    if (!place) return null;

    const [profileContacts, profileBookings] = await Promise.all([
      this.database.select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        role: organizationContacts.role,
        isPrimary: organizationContacts.isPrimary,
        phone: contacts.phone,
        email: contacts.email,
        source: organizationContacts.source,
        actRecordId: contacts.actRecordId,
        locationName: organizationLocations.label,
        locationCity: organizationLocations.city,
        locationRegion: organizationLocations.region,
      }).from(organizationContacts)
        .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
        .leftJoin(organizationLocations, eq(organizationLocations.id, contacts.organizationLocationId))
        .where(activeOrganizationContactCondition(profileId))
        .orderBy(desc(organizationContacts.isPrimary), asc(organizationContacts.role), asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id)),
      this.database.select({
        id: bookings.id,
        name: bookings.name,
        primaryContactId: bookings.primaryContactId,
        city: bookings.city,
        region: bookings.region,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
        probability: bookings.probability,
        notes: bookings.notes,
        actRecordId: bookings.actRecordId,
      }).from(bookings).where(eq(bookings.organizationId, profileId))
        .orderBy(desc(bookings.startsAt), asc(bookings.name), asc(bookings.id)),
    ]);
    const bookingIds = profileBookings.map((booking) => booking.id);
    const contactIds = profileContacts.map((contact) => contact.id);
    const directActivityCondition = organizationOwnedRecordCondition(
      {
        organizationId: activities.organizationId,
        bookingId: activities.bookingId,
        contactId: activities.contactId,
      },
      eq(activities.organizationId, profileId),
      bookingIds.length
        ? inArray(activities.bookingId, bookingIds)
        : sql`false`,
      contactIds.length
        ? inArray(activities.contactId, contactIds)
        : sql`false`,
    );
    // Imported Act! timeline records are linked through activity_associations
    // rather than direct FK columns, so include entries associated with this
    // place or any of its profile contacts/bookings.
    const associationCondition = exists(
      this.database
        .select({ id: activityAssociations.id })
        .from(activityAssociations)
        .where(and(
          eq(activityAssociations.activityId, activities.id),
          or(
            eq(activityAssociations.organizationId, profileId),
            contactIds.length
              ? inArray(activityAssociations.contactId, contactIds)
              : sql`false`,
            bookingIds.length
              ? inArray(activityAssociations.bookingId, bookingIds)
              : sql`false`,
          ),
        )),
    );
    const profileCondition = or(directActivityCondition, associationCondition);
    const followUpCondition = organizationOwnedRecordCondition(
      {
        organizationId: followUps.organizationId,
        bookingId: followUps.bookingId,
        contactId: followUps.contactId,
      },
      eq(followUps.organizationId, profileId),
      bookingIds.length
        ? inArray(followUps.bookingId, bookingIds)
        : sql`false`,
      contactIds.length
        ? inArray(followUps.contactId, contactIds)
        : sql`false`,
    );
    const [profileActivities, profileFollowUps, groupMemberships, migrationAudits] = await Promise.all([
      this.database.select({
        id: activities.id,
        contactId: activities.contactId,
        bookingId: activities.bookingId,
        kind: activities.kind,
        subject: activities.subject,
        body: activities.body,
        occurredAt: activities.timelineSortAt,
        sourceOccurredAt: activities.occurredAt,
        dateIsImportFallback: activities.dateIsImportFallback,
        createdAt: activities.createdAt,
        updatedAt: activities.updatedAt,
        importedFromAct: isNotNull(activities.sourceRecordId),
        actSourceType: activities.sourceType,
      }).from(activities).where(and(profileCondition, isNull(activities.deletedAt)))
        .orderBy(desc(activities.timelineSortAt), desc(activities.id))
        .limit(PROFILE_ACTIVITY_LIMIT),
      this.database.select({
        id: followUps.id,
        contactId: followUps.contactId,
        bookingId: followUps.bookingId,
        kind: followUps.kind,
        dueAt: followUps.dueAt,
        completedAt: followUps.completedAt,
      }).from(followUps).where(followUpCondition)
        .orderBy(asc(followUps.completedAt), asc(followUps.dueAt), asc(followUps.id)),
      this.database.select({
        id: callingLists.id,
        name: callingLists.name,
        kind: callingLists.kind,
        source: callingListMemberships.source,
        sourceStatus: callingLists.sourceStatus,
        actRecordId: actExternalLinks.actRecordId,
      }).from(callingListMemberships)
        .innerJoin(organizationContacts, eq(organizationContacts.contactId, callingListMemberships.contactId))
        .innerJoin(callingLists, eq(callingLists.id, callingListMemberships.callingListId))
        .leftJoin(actExternalLinks, and(
          eq(actExternalLinks.entityType, "calling_list"),
          eq(actExternalLinks.entityId, callingLists.id),
          eq(actExternalLinks.sourceEntityType, "group"),
        ))
        .where(and(activeOrganizationContactCondition(profileId), eq(callingListMemberships.active, true)))
        .orderBy(asc(callingLists.name), asc(callingLists.id)),
      this.database.select({ after: auditEntries.after }).from(auditEntries)
        .where(and(eq(auditEntries.entityType, "organization"), eq(auditEntries.entityId, profileId), eq(auditEntries.action, "act_migration_applied")))
        .orderBy(desc(auditEntries.createdAt)),
    ]);
    const decoratedProfileActivities: EventProfileActivityRecord[] = profileActivities.map((activity) => ({
      id: activity.id,
      contactId: activity.contactId,
      bookingId: activity.bookingId,
      kind: activity.kind,
      subject: activity.subject,
      body: activity.body,
      occurredAt: activity.occurredAt,
      createdAt: activity.createdAt,
      updatedAt: activity.updatedAt,
      importedFromAct: Boolean(activity.importedFromAct),
      actSourceType: activity.actSourceType,
      historicalDateUnknown: activity.actSourceType === "paper_note"
        && activity.sourceOccurredAt === null
        && activity.dateIsImportFallback,
      paperNoteSource: activity.actSourceType === "paper_note"
        ? { activityId: activity.id }
        : null,
    }));
    const groups = [...new Map(groupMemberships.map((group) => [group.id, group])).values()];
    const entityIds = [
      place.id,
      ...profileContacts.map((contact) => contact.id),
      ...profileBookings.map((booking) => booking.id),
      ...groups.map((group) => group.id),
    ];
    const externalLinks = entityIds.length === 0 ? [] : await this.database.select({
      entityType: actExternalLinks.entityType,
      entityId: actExternalLinks.entityId,
      sourceEntityType: actExternalLinks.sourceEntityType,
      actRecordId: actExternalLinks.actRecordId,
      isPrimary: actExternalLinks.isPrimary,
      syncMode: actExternalLinks.syncMode,
    }).from(actExternalLinks).where(inArray(actExternalLinks.entityId, entityIds))
      .orderBy(asc(actExternalLinks.entityType), asc(actExternalLinks.entityId), asc(actExternalLinks.sourceEntityType), asc(actExternalLinks.actRecordId));

    const merged = migrationAudits.flatMap(({ after }) => {
      const value = after && typeof after === "object" && !Array.isArray(after)
        ? (after as Record<string, unknown>).mergedProfileHistory
        : null;
      return value && typeof value === "object" && !Array.isArray(value) ? [value as Record<string, unknown>] : [];
    });
    const history = Object.fromEntries(["contactSourceIds", "phones", "notes", "bookingSourceIds", "groupSourceIds"].map((key) => [
      key,
      [...new Set(merged.flatMap((entry) => Array.isArray(entry[key]) ? entry[key].filter((item): item is string => typeof item === "string") : []))].toSorted(),
    ])) as EventProfile["migrationHistory"];
    return buildEventProfile({
      place,
      contacts: profileContacts,
      bookings: profileBookings,
      activities: decoratedProfileActivities,
      followUps: profileFollowUps,
      groups,
      externalLinks: externalLinks as EventProfileSourceReference[],
    }, selectedContactId, history);
  }
}