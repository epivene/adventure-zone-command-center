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

export type ContactDetail = {
  contact: ContactListRecord & {
    actRecordId: string | null;
    createdAt: Date;
  };
  relatedBookings: ContactRelatedBooking[];
};
