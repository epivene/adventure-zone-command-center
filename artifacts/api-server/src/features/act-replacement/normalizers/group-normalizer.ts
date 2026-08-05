import {
  bad,
  d,
  ok,
  record,
  text,
  unknown,
  type NormalizeResult,
} from "./value-readers";
export type Group = {
  kind: "calling_list";
  name: string;
  staticMemberSourceIds: string[];
  unsupportedFilter: null;
};
const allowed = new Set([
  "name",
  "Name",
  "description",
  "Description",
  "id",
  "Id",
  "ID",
  "customFields",
  "CustomFields",
]);
export const normalizeGroup = (
  raw: unknown,
  c: { staticMemberSourceIds?: readonly string[] } = {},
): NormalizeResult<Group> => {
  const z = d(),
    r = record(raw);
  if (!r) return bad({}, "invalid_source_record", z);
  if (text(r, ["description", "Description"])) {
    z.w.add("group_description_archived_only");
    z.p.add("description");
  }
  const v = {
    kind: "calling_list" as const,
    name: text(r, ["name", "Name"]) ?? "",
    staticMemberSourceIds: [
      ...new Set(
        (c.staticMemberSourceIds ?? [])
          .filter((x) => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ].sort(),
    unsupportedFilter: null,
  };
  unknown(r, allowed, z);
  return v.name ? ok(v, z) : bad(v, "missing_required_name", z);
};
