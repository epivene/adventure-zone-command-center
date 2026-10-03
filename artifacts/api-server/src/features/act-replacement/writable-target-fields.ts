/** The sole allow-list shared by manifest construction and durable target writes. */
export const writableTargetFieldColumns: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  organization: {
    name: "name", phone: "phone", website: "website", industry: "act_industry",
    address1: "address_1", address2: "address_2", city: "city", region: "region", postalCode: "postal_code",
  },
  contact: {
    firstName: "first_name", lastName: "last_name", email: "email", phone: "phone", jobTitle: "job_title",
    address1: "address_1", address2: "address_2", city: "city", region: "region", postalCode: "postal_code",
  },
  booking: {
    name: "name", venueName: "venue_name", address1: "address_1", city: "city", region: "region", postalCode: "postal_code",
    startsAt: "starts_at", endsAt: "ends_at", localStatus: "status", localProbability: "probability", notes: "notes",
  },
  calling_list: { name: "name" },
  activity: {
    category: "kind", subject: "subject", status: "status", body: "body", sourceOccurredAt: "occurred_at",
    timelineSortAt: "timeline_sort_at", dateIsImportFallback: "date_is_import_fallback", endsAt: "ends_at", sourceType: "source_type",
  },
};

const normalizedMetadataFields: Readonly<Record<string, ReadonlySet<string>>> = {
  organization: new Set(["kind"]),
  contact: new Set(["kind", "emailIdentityMatchSafe"]),
  booking: new Set(["kind", "organizationSourceId", "salesMilestones"]),
  calling_list: new Set(["kind", "staticMemberSourceIds", "unsupportedFilter"]),
  activity: new Set(["kind", "calendarCapable"]),
};

export function writablePhysicalColumn(entityType: string, logicalField: string): string | null {
  return writableTargetFieldColumns[entityType]?.[logicalField] ?? null;
}

const nonTextWritableFields = new Set([
  "booking.startsAt", "booking.endsAt",
  "activity.sourceOccurredAt", "activity.timelineSortAt", "activity.dateIsImportFallback", "activity.endsAt",
]);

export function writableFieldAcceptsBlank(entityType: string, logicalField: string): boolean {
  return !nonTextWritableFields.has(`${entityType}.${logicalField}`);
}

export function isNormalizedMetadataField(entityType: string, logicalField: string, normalized: Readonly<Record<string, unknown>>): boolean {
  if (normalizedMetadataFields[entityType]?.has(logicalField)) return true;
  return entityType === "booking" && logicalField === "actStatus" && normalized.localStatus != null;
}

export function isMateriallyPopulated(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
