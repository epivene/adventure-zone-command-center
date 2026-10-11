import { and, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";

import { organizationContacts } from "@/db/schema";
import type { ProfileQuickFilter, ProfileSort } from "@/features/organizations/last-resort-input";

export type ProfileParentContext =
  | { kind: "event_family"; id: string; name: string }
  | { kind: "organization_group"; id: string; name: string }
  | null;

export type OrganizationListRecord = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  lastResort: boolean;
  lastResortReason: string | null;
  lastResortChangedAt: Date | null;
  filler: boolean;
  fillerReason: string | null;
  fillerChangedAt: Date | null;
  contactCount: number;
  bookingCount: number;
  primaryContactName: string | null;
  primaryContactEmail?: string | null;
  primaryContactPhone?: string | null;
  nextEventDate?: string | null;
  effectiveEventDate?: {
    startsOn: string;
    endsOn: string | null;
    displayStatus: "booked" | "confirmed" | "expected";
    sourceId: string;
  } | null;
  latestRecordedEventDate?: {
    startsOn: string;
    endsOn: string | null;
  } | null;
  applicationDeadline?: string | null;
  pipelineStatus?: string | null;
  priority?: string | null;
  decisionStatus?: "deadline_soon" | "needs_follow_up" | "contacted" | "waiting" | "booked" | "not_a_fit" | "unrecorded";
  recommendedDealModel?: "flat_fee" | "pay_per_play" | "either" | null;
  nextActionKind?: string | null;
  nextActionDueAt?: string | null;
  locationCount: number;
  matchedLocation: { id: string; label: string; city: string | null; region: string | null } | null;
  eventFamilyId?: string | null;
  parentContext?: ProfileParentContext;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  description?: string | null;
  placeType?: string | null;
  profileImageDataUrl?: string | null;
  ratingAverage?: number | null;
  ratingCount?: number;
};

export type OrganizationListPage = {
  records: OrganizationListRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type OrganizationListQuery = {
  search: string;
  directoryView?: "all" | "events" | "organizations";
  lastResort: "all" | "only";
  filler: "all" | "only";
  travelLegId: string | null;
  placeType: string | null;
  region: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  hasFollowUp: boolean;
  hasBooking: boolean;
  hasLocations: boolean;
  showMembers: boolean;
  quickFilter?: ProfileQuickFilter | null;
  sort: ProfileSort;
  includeRetired?: boolean;
  page: number;
  pageSize: number;
};

export function activeOrganizationContactCondition(organizationId: string) {
  return and(
    eq(organizationContacts.organizationId, organizationId),
    eq(organizationContacts.active, true),
  )!;
}

export function organizationOwnedRecordCondition(
  columns: { organizationId: SQLWrapper; bookingId: SQLWrapper; contactId: SQLWrapper },
  matchesExplicitOrganization: SQL,
  matchesBookingOrganization: SQL,
  matchesContactAssociation: SQL,
): SQL {
  return sql`(
    (${columns.organizationId} is not null and ${matchesExplicitOrganization})
    or (${columns.organizationId} is null and ${columns.bookingId} is not null and ${matchesBookingOrganization})
    or (${columns.organizationId} is null and ${columns.bookingId} is null and ${columns.contactId} is not null and ${matchesContactAssociation})
  )`;
}
