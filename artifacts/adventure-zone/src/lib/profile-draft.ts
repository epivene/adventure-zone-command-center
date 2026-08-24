export type ProfileDraftContact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  primary: boolean;
};

export type ProfileDraft = {
  eventName: string;
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
        const value = JSON.parse(raw) as ProfileDraft;
        if (!value || typeof value !== "object" || !Array.isArray(value.contacts)) return null;
        return value;
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
