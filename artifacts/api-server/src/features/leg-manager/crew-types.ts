export const crewRehireStatuses = ["rehirable", "undecided", "do_not_rehire"] as const;
export type CrewRehireStatus = (typeof crewRehireStatuses)[number];

export type CrewWorker = {
  id: string;
  name: string;
  phone: string | null;
  normalizedPhone: string | null;
  email: string | null;
  city: string | null;
  region: string | null;
  locationText: string | null;
  rehireStatus: CrewRehireStatus;
};

export type CrewWorkHistory = {
  id: string;
  workerId: string;
  legId: string;
  bookingId: string | null;
  tripId: string | null;
  role: string;
  startedAt: Date;
  endedAt: Date | null;
  rating: number | null;
  note: string | null;
};

export type CrewManagerNote = {
  id: string;
  workerId: string;
  legId: string;
  bookingId: string | null;
  note: string;
};

export type CrewWorkerWithHistory = CrewWorker & {
  workHistory: CrewWorkHistory[];
  managerNotes: CrewManagerNote[];
};

export function normalizeCrewPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}
