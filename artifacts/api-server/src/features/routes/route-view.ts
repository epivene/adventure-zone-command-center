import type { BookingStatus } from "@/features/bookings/booking-types";

export type RouteViewMode = "full" | "confirmed" | "potential" | "history";
export type RouteBucket = "confirmed" | "potential" | "history" | "excluded";
export type RouteEmphasis = "primary" | "dimmed" | "hidden";

const historyStatuses = new Set<BookingStatus>([
  "declined",
  "cancelled",
  "completed",
  "renewal_due",
]);

export function classifyRouteBucket(status: BookingStatus): RouteBucket {
  if (status === "confirmed") return "confirmed";
  if (historyStatuses.has(status)) return "history";
  return "potential";
}

export function routeEmphasis(input: {
  bucket: RouteBucket;
  mode: RouteViewMode;
  eventLegId: string | null;
  focusedLegId: string | null;
}): RouteEmphasis {
  const { bucket, mode, eventLegId, focusedLegId } = input;
  if (bucket === "excluded") return "hidden";
  if (mode === "history" && bucket !== "history") return "hidden";
  if (mode !== "history" && bucket === "history") return "hidden";
  let emphasis: RouteEmphasis = "primary";
  if (mode === "confirmed" && bucket === "potential") emphasis = "dimmed";
  if (mode === "potential" && bucket === "confirmed") emphasis = "dimmed";
  if (focusedLegId && eventLegId !== focusedLegId) emphasis = "dimmed";
  return emphasis;
}
