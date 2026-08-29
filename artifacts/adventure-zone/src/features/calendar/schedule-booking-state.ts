export type ScheduleBookingStateInput = {
  status?: string | null;
  probability?: string | null;
};

const bookedStatuses = new Set(["contract_received", "confirmed", "completed"]);
const excludedStatuses = new Set(["declined", "cancelled"]);

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

export function isBookedForSchedule(input: ScheduleBookingStateInput): boolean {
  const status = normalized(input.status);
  if (excludedStatuses.has(status)) return false;
  return bookedStatuses.has(status) || normalized(input.probability) === "definite";
}

export function asScheduleCalendarEvent<T extends ScheduleBookingStateInput>(event: T): T {
  if (!isBookedForSchedule(event) || normalized(event.status) === "confirmed") return event;
  return { ...event, status: "confirmed" };
}
