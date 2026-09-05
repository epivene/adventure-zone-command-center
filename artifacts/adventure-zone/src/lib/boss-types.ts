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
  name?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  travelLegId?: string | null;
  eventDate?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  organization?: { id: string; name: string } | null;
  organizationName?: string | null;
  contactName?: string | null;
  city?: string | null;
  region?: string | null;
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
};

export type ScheduleLeg = {
  id: string;
  name?: string | null;
  color?: string | null;
  baseAddress?: string | null;
  defaultVehicleName?: string | null;
  defaultMpg?: number | null;
  archivedAt?: string | null;
  bookings?: Array<{ id: string; name?: string | null; startsAt?: string | null; status?: string | null }>;
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
