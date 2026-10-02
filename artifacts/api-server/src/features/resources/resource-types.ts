import type { ResolvedDates } from "../booking-date-repair/date-evidence";
export const resourceWarningCodeValues = [
  "RESOURCE_OVERLAP",
  "RESOURCE_DATE_EVIDENCE_UNRESOLVED",
  "PAINTBALL_TRANSFER_TIME",
  "TRANSFER_TRIP_MISSING",
  "RESOURCE_LOCATION_UNKNOWN",
  "ATTRACTION_TOTAL_MISMATCH",
  "RESOURCE_UNAVAILABLE",
] as const;

export type ResourceWarningCode = (typeof resourceWarningCodeValues)[number];

export type ResourceAvailabilityStatus =
  | "available"
  | "unavailable"
  | "maintenance"
  | "archived";

export type ResourceLocation = {
  latitude: number;
  longitude: number;
};

export type ResourceReservation = {
  dateProvenance?: ResolvedDates;
  assignmentId: string;
  bookingId: string;
  bookingName: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceStatus: ResourceAvailabilityStatus;
  countsAsAttraction: boolean;
  movable: boolean;
  setupMinutes: number;
  teardownMinutes: number;
  minimumTransferMinutes: number;
  startsAt: Date | null;
  endsAt: Date | null;
  location: ResourceLocation | null;
};

export type ResourceConflictOverrideSummary = {
  reason: string;
  acknowledgedBy: string;
  createdAt: Date;
};

export type ResourceWarning = {
  code: ResourceWarningCode;
  conflictKey: string;
  resourceId: string | null;
  assignmentIds: string[];
  message: string;
  overridden: boolean;
  override: ResourceConflictOverrideSummary | null;
};

export type BookingResourceAssignmentSummary = {
  id: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceStatus: ResourceAvailabilityStatus;
  countsAsAttraction: boolean;
  attributionSource: "inferred" | "manual";
};

export type BookingResourceSummary = {
  bookingId: string;
  assignments: BookingResourceAssignmentSummary[];
  assignedAttractionCount: number;
  warnings: ResourceWarning[];
};
