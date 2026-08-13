import type { ContactPhoneRecord } from "@/features/contact-phones/contact-phone-types";

export const contactSyncStateValues = [
  "unlinked",
  "synced",
  "waiting",
  "conflict",
] as const;

export type ContactSyncState = (typeof contactSyncStateValues)[number];

export type ContactFields = {
  firstName: string;
  lastName: string;
  organizationName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export type ContactListQuery = {
  search: string;
  state: ContactSyncState | "all";
  page: number;
  pageSize: number;
};

export type ContactListRecord = ContactFields & {
  id: string;
  syncState: ContactSyncState;
  updatedAt: Date;
  lastSyncedAt: Date | null;
  organizationLastResort?: boolean;
  organizationLastResortReason?: string | null;
};

export type PhoneMatch =
  | { kind: "one"; contact: ContactListRecord }
  | { kind: "many"; contacts: ContactListRecord[] }
  | { kind: "none"; normalizedPhone: string };

export type QuickCallerInput = {
  requestKey: string;
  firstName: string;
  lastName: string;
  organizationName: string;
  phone: string | null;
  email: string | null;
  reason: string;
  eventDate: string | null;
  eventLocation: string | null;
};

export type ContactListPage = {
  records: ContactListRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type ContactRelatedBooking = {
  id: string;
  name: string;
  city: string;
  region: string;
  startsAt: Date | null;
  status: string;
};

export type PersonPlace = {
  id: string;
  name: string;
  role: string | null;
  isPrimaryPerson: boolean;
  isPrimaryPlace: boolean;
  active: boolean;
};

export type ContactDetail = {
  contact: ContactListRecord & {
    actRecordId: string | null;
    createdAt: Date;
  };
  places: PersonPlace[];
  relatedBookings: ContactRelatedBooking[];
  phones: ContactPhoneRecord[];
};
