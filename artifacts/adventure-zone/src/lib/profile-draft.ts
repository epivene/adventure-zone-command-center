export type ProfileDraftContact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  primary: boolean;
};

export type ProfileDraftPlaceType =
  | "fair"
  | "city_government"
  | "festival_event"
  | "venue"
  | "school"
  | "tribe"
  | "association"
  | "company"
  | "other";

export type ProfileDraftBookingStatus =
  | "new_lead"
  | "researching"
  | "contact_due"
  | "contacted"
  | "interested"
  | "possible"
  | "unlikely"
  | "quote_sent"
  | "pending_decision"
  | "pending_contract"
  | "contract_received"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "completed"
  | "renewal_due";

export type ProfileDraft = {
  eventName: string;
  placeType: ProfileDraftPlaceType;
  description: string;
  phone: string;
  website: string;
  address1: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
  familyId: string;
  contacts: ProfileDraftContact[];
  includeBooking: boolean;
  bookingName: string;
  bookingStatus: ProfileDraftBookingStatus;
  startsAt: string;
  endsAt: string;
  travelLegId: string;
  nextActionKind: string;
  nextActionDueAt: string;
  savedAt: string;
};

const PROFILE_DRAFT_KEY = "adventure-zone:new-profile-draft:v1";

export function createProfileDraftStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  return {
    load(): ProfileDraft | null {
      const raw = storage.getItem(PROFILE_DRAFT_KEY);
      if (!raw) return null;
      try {
        const value = JSON.parse(raw) as Partial<ProfileDraft>;
        if (!value || typeof value !== "object" || !Array.isArray(value.contacts)) return null;
        return {
          eventName: value.eventName ?? "",
          placeType: value.placeType ?? "festival_event",
          description: value.description ?? "",
          phone: value.phone ?? "",
          website: value.website ?? "",
          address1: value.address1 ?? "",
          address2: value.address2 ?? "",
          city: value.city ?? "",
          region: value.region ?? "",
          postalCode: value.postalCode ?? "",
          familyId: value.familyId ?? "",
          contacts: value.contacts,
          includeBooking: value.includeBooking ?? false,
          bookingName: value.bookingName ?? "",
          bookingStatus: value.bookingStatus ?? "new_lead",
          startsAt: value.startsAt ?? "",
          endsAt: value.endsAt ?? "",
          travelLegId: value.travelLegId ?? "",
          nextActionKind: value.nextActionKind ?? "call",
          nextActionDueAt: value.nextActionDueAt ?? "",
          savedAt: value.savedAt ?? "",
        };
      } catch {
        return null;
      }
    },
    save(draft: ProfileDraft) {
      storage.setItem(PROFILE_DRAFT_KEY, JSON.stringify(draft));
    },
    clear() {
      storage.removeItem(PROFILE_DRAFT_KEY);
    },
  };
}

export function browserProfileDraftStore() {
  if (typeof window === "undefined") return null;
  return createProfileDraftStore(window.localStorage);
}
