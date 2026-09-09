export type ManagerMeetupParticipant =
  | { kind: "leg"; legId: string; legName: string }
  | { kind: "external_contact"; externalContactId: string | null; displayName: string; phone: string | null; email: string | null };
import type { ManagerScheduleState } from "@workspace/api-zod";

export type ManagerScopedMapData = {
  leg: { id: string; name: string; color: string | null };
  route: null | {
    trip: {
      id: string;
      name: string;
      startLabel: string;
      startLatitude: number | null;
      startLongitude: number | null;
      endLabel: string;
      endLatitude: number | null;
      endLongitude: number | null;
      mpg: number | null;
      fuelPricePerGallon: number | null;
    };
    stops: Array<{
      id: string;
      bookingId: string;
      bookingName: string;
      city: string;
      region: string;
      latitude: number | null;
      longitude: number | null;
      sortOrder: number;
      startsAt: Date | null;
      endsAt: Date | null;
      status: string;
      probability: string | null;
      scheduleState: ManagerScheduleState;
    }>;
    segments: Array<{ id: string; fromLabel: string; toLabel: string; effectiveMiles: number | null; effectiveMinutes: number | null }>;
  };
  events: Array<{
    bookingId: string;
    bookingName: string;
    city: string;
    region: string;
    latitude: number | null;
    longitude: number | null;
    startsAt: Date | null;
    endsAt: Date | null;
    status: string;
    probability: string | null;
    scheduleState: ManagerScheduleState;
  }>;
  meetups: Array<{
    id: string;
    status: "suggested" | "dismissed" | "approved" | "needs_review";
    resourceName: string | null;
    meetupLabel: string;
    meetupLatitude: number;
    meetupLongitude: number;
    windowStartsAt: Date;
    windowEndsAt: Date;
    counterpart: ManagerMeetupParticipant;
  }>;
};

export type ManagerMapVariant = "events" | "operations";
