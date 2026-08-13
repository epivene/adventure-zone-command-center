export const contactPhoneTypeValues = ["mobile", "office", "alternate", "unknown"] as const;

export type ContactPhoneType = (typeof contactPhoneTypeValues)[number];

export type ContactPhoneInput = {
  id: string | null;
  number: string;
  type: ContactPhoneType;
  extension: string | null;
  label: string | null;
  primary: boolean;
};

export type ContactPhoneRecord = Omit<ContactPhoneInput, "id"> & {
  id: string;
  contactId: string;
  normalizedNumber: string | null;
  source: string;
  doNotCallAt: Date | null;
  doNotCallReason: string | null;
};
