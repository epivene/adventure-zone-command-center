import type { ContactFields } from "@/features/contacts/contact-types";

export type ContactSnapshot = ContactFields;

function clean(value: string | null) {
  if (value === null) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || null;
}

export function canonicalContactSnapshot(
  fields: ContactFields,
): ContactSnapshot {
  return {
    firstName: clean(fields.firstName) ?? "",
    lastName: clean(fields.lastName) ?? "",
    organizationName: clean(fields.organizationName),
    jobTitle: clean(fields.jobTitle),
    email: clean(fields.email)?.toLocaleLowerCase("en-US") ?? null,
    phone: clean(fields.phone),
    address1: clean(fields.address1),
    address2: clean(fields.address2),
    city: clean(fields.city),
    region: clean(fields.region),
    postalCode: clean(fields.postalCode),
  };
}

function comparable(snapshot: ContactSnapshot) {
  return Object.fromEntries(
    Object.entries(canonicalContactSnapshot(snapshot)).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value.toLocaleLowerCase("en-US")
        : value,
    ]),
  );
}

export function contactSnapshotsEqual(
  left: ContactSnapshot | null,
  right: ContactSnapshot | null,
) {
  if (left === null || right === null) return left === right;
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}
