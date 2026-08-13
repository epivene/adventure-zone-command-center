export const contactPhoneTypeValues = ["mobile", "office", "alternate", "unknown"] as const;

export type ContactPhoneType = (typeof contactPhoneTypeValues)[number];

export type ContactPhoneInput = {
  id: string | null;
  number: string;
  type: ContactPhoneType;
  extension: string | null;
  label: string | null;
  primary: boolean;
  doNotCallAt?: string | null;
  doNotCallReason?: string | null;
};

export type ContactPhoneRecord = ContactPhoneInput & {
  id: string;
  contactId: string;
  normalizedNumber: string | null;
  source: string;
  doNotCallAt: string | null;
  doNotCallReason: string | null;
};
