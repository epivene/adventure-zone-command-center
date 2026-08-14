import { and, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";

import { organizationContacts } from "@/db/schema";

export type OrganizationListRecord = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  lastResort: boolean;
  lastResortReason: string | null;
  lastResortChangedAt: Date | null;
  contactCount: number;
  bookingCount: number;
  primaryContactName: string | null;
  locationCount: number;
  matchedLocation: { id: string; label: string; city: string | null; region: string | null } | null;
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
  lastResort: "all" | "only";
  travelLegId: string | null;
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
