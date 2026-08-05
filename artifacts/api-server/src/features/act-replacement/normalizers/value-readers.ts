export type NormalizeResult<T> =
  | { ok: true; value: T; warnings: string[]; unsupportedFieldPaths: string[] }
  | {
      ok: false;
      partial: Partial<T>;
      issueCode: string;
      warnings: string[];
      unsupportedFieldPaths: string[];
    };
export type D = { w: Set<string>; p: Set<string> };
export const d = (): D => ({ w: new Set(), p: new Set() });
export const record = (x: unknown): Record<string, unknown> | null => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const ks = Object.keys(r);
  for (const k of ["value", "Value"] as const)
    if (
      r[k] &&
      typeof r[k] === "object" &&
      !Array.isArray(r[k]) &&
      ks.every((x) => x === k || x.startsWith("@odata."))
    )
      return r[k] as Record<string, unknown>;
  return r;
};
export const text = (
  r: Record<string, unknown>,
  ks: string[],
): string | null => {
  for (const k of ks)
    if (Object.hasOwn(r, k)) {
      const x = r[k];
      return typeof x === "string" && x.trim() ? x.trim() : null;
    }
  return null;
};
export const present = (r: Record<string, unknown>, ks: string[]) =>
  ks.find((k) => Object.hasOwn(r, k));
export const addr = (
  r: Record<string, unknown>,
  ks: string[],
  path: string,
  z: D,
) => {
  const k = present(r, ks);
  if (!k || r[k] == null)
    return {
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
    };
  const a = record(r[k]);
  if (!a) {
    z.w.add("malformed_address");
    z.p.add(path);
    return {
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
    };
  }
  return {
    address1: text(a, ["line1", "Line1", "address1", "Address1"]),
    address2: text(a, ["line2", "Line2", "address2", "Address2"]),
    city: text(a, ["city", "City"]),
    region: text(a, ["state", "State", "region", "Region"]),
    postalCode: text(a, ["postalCode", "PostalCode", "zipCode", "ZipCode"]),
  };
};
export const unknown = (
  r: Record<string, unknown>,
  allowed: Set<string>,
  z: D,
) => {
  let u = false;
  for (const k of Object.keys(r)) {
    if (k === "customFields" || k === "CustomFields") {
      z.p.add("customFields[]");
      continue;
    }
    if (!allowed.has(k)) u = true;
  }
  if (u) z.p.add("unknownFields[]");
  if (u || z.p.has("customFields[]")) z.w.add("unsupported_source_fields");
};
export const ok = <T>(v: T, z: D): NormalizeResult<T> => ({
  ok: true,
  value: v,
  warnings: [...z.w].sort(),
  unsupportedFieldPaths: [...z.p].sort(),
});
export const bad = <T>(v: Partial<T>, i: string, z: D): NormalizeResult<T> => ({
  ok: false,
  partial: v,
  issueCode: i,
  warnings: [...z.w].sort(),
  unsupportedFieldPaths: [...z.p].sort(),
});
export const validDate = (x: string | null): x is string => {
  if (!x) return false;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(
      x,
    );
  if (!m) return false;
  const year = Number(m[1]),
    month = Number(m[2]),
    day = Number(m[3]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate()
  )
    return false;
  if (
    m[4] !== undefined &&
    (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59)
  )
    return false;
  return !Number.isNaN(Date.parse(x));
};
