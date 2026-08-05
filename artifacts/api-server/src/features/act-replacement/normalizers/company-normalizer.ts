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
export type Company = {
  kind: "organization";
  name: string;
  phone: string | null;
  website: string | null;
  industry: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};
const allowed = new Set([
  "id",
  "Id",
  "ID",
  "name",
  "Name",
  "phone",
  "Phone",
  "website",
  "Website",
  "industry",
  "Industry",
  "address",
  "Address",
  "edited",
  "Edited",
  "customFields",
  "CustomFields",
]);
export const normalizeCompany = (raw: unknown): NormalizeResult<Company> => {
  const z = d(),
    r = record(raw);
  if (!r) return bad({}, "invalid_source_record", z);
  const a = addr(r, ["address", "Address"], "address", z),
    v = {
      kind: "organization" as const,
      name: text(r, ["name", "Name"]) ?? "",
      phone: text(r, ["phone", "Phone"]),
      website: text(r, ["website", "Website"]),
      industry: text(r, ["industry", "Industry"]),
      ...a,
    };
  unknown(r, allowed, z);
  return v.name ? ok(v, z) : bad(v, "missing_required_name", z);
};
