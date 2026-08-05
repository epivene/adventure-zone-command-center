import {
  isSharedMailboxEmail,
  normalizeMatchingEmail,
} from "@/features/act-migration/matching-normalization";
import {
  bad,
  d,
  addr,
  ok,
  record,
  text,
  unknown,
  type NormalizeResult,
} from "./value-readers";
export type Contact = {
  kind: "contact";
  firstName: string;
  lastName: string;
  email: string | null;
  emailIdentityMatchSafe: boolean;
  phone: string | null;
  jobTitle: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};
const allowed = new Set([
  "firstName",
  "FirstName",
  "lastName",
  "LastName",
  "emailAddress",
  "EmailAddress",
  "businessPhone",
  "BusinessPhone",
  "phone",
  "Phone",
  "jobTitle",
  "JobTitle",
  "businessAddress",
  "BusinessAddress",
  "fullName",
  "FullName",
  "id",
  "Id",
  "ID",
  "customFields",
  "CustomFields",
]);
export const normalizeContact = (raw: unknown): NormalizeResult<Contact> => {
  const z = d(),
    r = record(raw);
  if (!r) return bad({}, "invalid_source_record", z);
  const email = text(r, ["emailAddress", "EmailAddress"]),
    n = normalizeMatchingEmail(email),
    shared = isSharedMailboxEmail(n);
  if (shared) z.w.add("shared_mailbox_email_identity_unsafe");
  const v = {
    kind: "contact" as const,
    firstName: text(r, ["firstName", "FirstName"]) ?? "",
    lastName: text(r, ["lastName", "LastName"]) ?? "",
    email,
    emailIdentityMatchSafe: !!n && !shared,
    phone: text(r, ["businessPhone", "BusinessPhone", "phone", "Phone"]),
    jobTitle: text(r, ["jobTitle", "JobTitle"]),
    ...addr(r, ["businessAddress", "BusinessAddress"], "businessAddress", z),
  };
  unknown(r, allowed, z);
  return v.firstName && v.lastName
    ? ok(v, z)
    : bad(v, "missing_required_contact_name", z);
};
