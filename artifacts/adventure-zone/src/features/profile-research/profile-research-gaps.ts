export type ResearchGapProfile = {
  place: {
    website?: string | null;
    phone?: string | null;
    city?: string | null;
    region?: string | null;
  };
  contacts?: Array<{
    email?: string | null;
    phone?: string | null;
  }>;
  bookings?: Array<{
    startsAt?: Date | string | null;
  }>;
};

export type ProfileResearchGapHint = {
  key: "website" | "phone" | "location" | "contact" | "contact_method" | "next_event_dates";
  label: string;
};

function present(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function timestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function profileResearchGaps(profile: ResearchGapProfile, now = new Date()): ProfileResearchGapHint[] {
  const gaps: ProfileResearchGapHint[] = [];
  if (!present(profile.place.website)) gaps.push({ key: "website", label: "Website" });
  if (!present(profile.place.phone)) gaps.push({ key: "phone", label: "Public phone" });
  if (!present(profile.place.city) || !present(profile.place.region)) gaps.push({ key: "location", label: "City / state" });

  const contacts = profile.contacts ?? [];
  if (!contacts.length) {
    gaps.push({ key: "contact", label: "Organizer contact" });
  } else if (!contacts.some((contact) => present(contact.email) || present(contact.phone))) {
    gaps.push({ key: "contact_method", label: "Contact email or phone" });
  }

  const dates = (profile.bookings ?? []).map((booking) => timestamp(booking.startsAt)).filter((value): value is number => value !== null);
  if (dates.some((value) => value < now.getTime()) && !dates.some((value) => value >= now.getTime())) {
    gaps.push({ key: "next_event_dates", label: "Next event dates" });
  }

  return gaps;
}
