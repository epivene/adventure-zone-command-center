import type { ComponentProps } from "react";
import type { OfficeProfileEditor } from "@/components/office/office-profile-editor";
import type { SimpleFullProfile } from "./simple-full-profile";
import type { ProfileAtAGlance } from "./profile-at-a-glance";

export type BossProfile = ComponentProps<typeof OfficeProfileEditor>["profile"] & {
  contacts: Array<{ id: string; name: string; role: string | null; isPrimary: boolean; phone: string | null; email: string | null; locationName: string | null }>;
  bookings: Array<{ id: string; name: string; primaryContactId: string | null; city: string; region: string; status: string; startsAt: string | null; endsAt: string | null }>;
  notes: Array<{ id: string; kind: string; body: string; occurredAt: string }>;
  atAGlance?: Omit<ComponentProps<typeof ProfileAtAGlance>["profile"], "contacts" | "bookings" | "notes">;
  presentation?: {
    managerReviews: import("./simple-full-profile").ProfileManagerReview[];
    placeType: string;
    familyContext: ComponentProps<typeof SimpleFullProfile>["profile"]["familyContext"];
    followUps: Array<{ id: string; contactId: string | null; bookingId: string | null; kind: string; dueAt: string; completedAt: string | null }>;
    bookingNotes: Array<{ id: string; notes: string | null }>;
    ratingSummary: { average: number | null; count: number };
  };
};

// Normalize the existing Boss read model once; both roles render the same component.
export function bossProfilePresentation(profile: BossProfile): ComponentProps<typeof SimpleFullProfile>["profile"] {
  const glance = profile.atAGlance;
  return {
    id: profile.id,
    place: {
      ...profile, id: profile.id, name: profile.name,
      placeType: profile.presentation?.placeType ?? "organization",
      description: profile.description,
      applicationDeadline: glance?.place.applicationDeadline,
      recommendedDealModel: glance?.place.recommendedDealModel,
      lastResort: false, lastResortReason: null, actRecordId: null,
    },
    contacts: profile.contacts.map((contact) => ({
      ...contact, source: "", actRecordId: null, locationCity: null, locationRegion: null,
    })),
    selectedContactId: profile.contacts.find((contact) => contact.isPrimary)?.id ?? profile.contacts[0]?.id ?? null,
    bookings: profile.bookings.map((booking) => ({
      ...booking, startsAt: booking.startsAt ? new Date(booking.startsAt) : null,
      endsAt: booking.endsAt ? new Date(booking.endsAt) : null,
      probability: "", actRecordId: null,
      notes: profile.presentation?.bookingNotes.find((item) => item.id === booking.id)?.notes ?? null,
    })),
    notes: profile.notes.map((note) => ({
      ...note, contactId: null, bookingId: null,
      occurredAt: new Date(note.occurredAt), createdAt: new Date(note.occurredAt), updatedAt: new Date(note.occurredAt),
    })),
    followUps: (profile.presentation?.followUps ?? []).map((item) => ({
      ...item, dueAt: new Date(item.dueAt), completedAt: item.completedAt ? new Date(item.completedAt) : null,
    })),
    effectiveEventDate: glance?.effectiveEventDate ?? null,
    eventDateFacts: (glance?.eventDateFacts ?? []) as ComponentProps<typeof SimpleFullProfile>["profile"]["eventDateFacts"],
    decisionSummary: glance?.decisionSummary,
    familyContext: profile.presentation?.familyContext ?? null,
    managerReviews: profile.presentation?.managerReviews ?? [],
    groups: [], sourceProvenance: [],
  };
}
