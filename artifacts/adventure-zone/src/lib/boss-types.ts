export type Assignment = {
  id: string;
  assigneeKind: "office" | "owner";
  officeAccountId: string | null;
  title: string;
  details: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  dueAt: string | null;
  status: "todo" | "in_progress" | "waiting" | "done" | "cancelled";
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BossBooking = {
  id: string;
  organizationId?: string | null;
  name?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  reservedStartsAt?: string | null;
  reservedEndsAt?: string | null;
  dateOnly?: boolean;
  reservedDateOnly?: boolean;
  reservedEndExclusive?: boolean;
  travelLegId?: string | null;
  eventDate?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  organization?: { id: string; name: string } | null;
  organizationName?: string | null;
  contactName?: string | null;
  city?: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  probability?: "definite" | "likely" | "possible" | "unlikely";
  travelLegName?: string | null;
  travelLegColor?: string | null;
  travelLegAssignmentKind?: "assigned" | "suggested" | null;
  legAssignmentWarning?: "long_travel" | "major_travel_concern" | null;
  legAssignmentExplanation?: string | null;
  routeBucket?: "confirmed" | "potential" | "history";
  locationQuality?: "coordinates" | "address" | "city" | "missing";
  locationLabel?: string | null;
  mappingState?:
    | "mapped_coordinates"
    | "mapped_address"
    | "mapped_city"
    | "needs_mapping_no_results"
    | "needs_mapping_provider_unavailable"
    | "needs_mapping_missing_location";
  seasonYear?: number | null;
  legName?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

export type BossContact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  organizationName?: string | null;
  role?: string | null;
  city?: string | null;
  region?: string | null;
  [key: string]: unknown;
};

export type BossSchedule = {
  legs: ScheduleLeg[];
  bookings: BossBooking[];
  displaySettings?: {
    eventColor: string;
    travelColor: string;
  };
};

export type ScheduleLeg = {
  id: string;
  name?: string | null;
  color?: string | null;
  sortOrder?: number;
  baseAddress?: string | null;
  defaultVehicleName?: string | null;
  defaultMpg?: number | null;
  archivedAt?: string | null;
  bookings?: Array<{ id: string; organizationId?: string | null; name?: string | null; startsAt?: string | null; status?: string | null; travelLegId?: string | null }>;
  trips?: Array<{ id: string; name?: string | null }>;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  route?: string | null;
  stops?: ScheduleStop[];
  [key: string]: unknown;
};

export type ScheduleStop = {
  id: string;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  [key: string]: unknown;
};

export type BossMaintenanceSummary = {
  id: string;
  recordKind?: "checklist" | "year_end_inspection";
  inspectionId?: string;
  bookingId?: string;
  legId: string | null;
  legName: string | null;
  title: string;
  phase: string;
  status: string;
  dueAt?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};
