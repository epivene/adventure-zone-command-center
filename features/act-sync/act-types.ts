import type { ContactFields } from "@/features/contacts/contact-types";

export type ActConfig = {
  baseUrl: "https://apius.act.com/act.web.api";
  databaseName: string;
  username: string;
  password: string;
};

export type RemoteActContact = ContactFields & {
  id: string;
  editedAt: string | null;
};

export type ActContactInput = ContactFields;

export type ActRateLimit = {
  limit: string | null;
  remaining: string | null;
  reset: string | null;
};
