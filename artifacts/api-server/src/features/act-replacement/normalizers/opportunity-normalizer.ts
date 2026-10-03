import {
  bookingStatusValues,
  probabilityValues,
} from "@/features/bookings/booking-types";
import {
  bad,
  d,
  addr,
  ok,
  record,
  text,
  unknown,
  validDate,
  type NormalizeResult,
} from "./value-readers";
export type Opportunity = {
  kind: "booking";
  name: string;
  organizationSourceId: string | null;
  venueName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  salesMilestones?: { estimatedCloseDate: string | null; actualCloseDate: string | null };
  actStatus: string | null;
  localStatus: string | null;
  probabilityPercent: number | null;
  localProbability: string | null;
  amount: string | null;
  notes: string | null;
};
const allowed = new Set([
  "name",
  "Name",
  "venueName",
  "VenueName",
  "address",
  "Address",
  "city",
  "City",
  "state",
  "State",
  "region",
  "Region",
  "postalCode",
  "PostalCode",
  "estimatedCloseDate",
  "EstimatedCloseDate",
  "actualCloseDate",
  "ActualCloseDate",
  "status",
  "Status",
  "probability",
  "Probability",
  "total",
  "Total",
  "notes",
  "Notes",
  "id",
  "Id",
  "ID",
  "customFields",
  "CustomFields",
]);
export const normalizeOpportunity = (
  raw: unknown,
  c: { organizationSourceId?: string | null } = {},
): NormalizeResult<Opportunity> => {
  const z = d(),
    r = record(raw);
  if (!r) return bad({}, "invalid_source_record", z);
  const a = addr(r, ["address", "Address"], "address", z),
    city = a.city ?? text(r, ["city", "City"]),
    region = a.region ?? text(r, ["state", "State", "region", "Region"]),
    status = text(r, ["status", "Status"]),
    rawProb = r.probability ?? r.Probability,
    prob =
      typeof rawProb === "number"
        ? String(rawProb)
        : text(r, ["probability", "Probability"]);
  const ls =
    status && bookingStatusValues.includes(status as never) ? status : null;
  const lp = prob && probabilityValues.includes(prob as never) ? prob : null;
  if (status && !ls) {
    z.w.add("unmapped_opportunity_status");
    z.p.add("status");
  }
  if (prob && !lp && Number.isNaN(Number(prob))) {
    z.w.add("unmapped_opportunity_probability");
    z.p.add("probability");
  }
  const pv =
    prob &&
    Number.isFinite(Number(prob)) &&
    Number(prob) >= 0 &&
    Number(prob) <= 100
      ? Number(prob)
      : null;
  const v = {
    kind: "booking" as const,
    name: text(r, ["name", "Name"]) ?? "",
    organizationSourceId: c.organizationSourceId ?? null,
    venueName: text(r, ["venueName", "VenueName"]),
    ...a,
    city,
    region,
    startsAt: null as string | null,
    endsAt: null as string | null,
    salesMilestones: {
      estimatedCloseDate: text(r, ["estimatedCloseDate", "EstimatedCloseDate"]),
      actualCloseDate: text(r, ["actualCloseDate", "ActualCloseDate"]),
    },
    actStatus: status,
    localStatus: ls,
    probabilityPercent: lp ? null : pv,
    localProbability: lp,
    amount:
      typeof r.total === "number"
        ? String(r.total)
        : text(r, ["total", "Total"]),
    notes: text(r, ["notes", "Notes"]),
  };
  if (v.salesMilestones.estimatedCloseDate && !validDate(v.salesMilestones.estimatedCloseDate)) {
    z.w.add("malformed_opportunity_date");
    z.p.add("estimatedCloseDate");
    v.startsAt = null;
  }
  if (v.salesMilestones.actualCloseDate && !validDate(v.salesMilestones.actualCloseDate)) {
    z.w.add("malformed_opportunity_date");
    z.p.add("actualCloseDate");
    v.endsAt = null;
  }
  if (
    prob &&
    !lp &&
    (Number.isNaN(Number(prob)) || Number(prob) < 0 || Number(prob) > 100)
  ) {
    z.w.add("unmapped_opportunity_probability");
    z.p.add("probability");
  }
  if (!v.name) return bad(v, "missing_required_name", z);
  if (!v.city || !v.region)
    return bad(v, "missing_required_booking_location", z);
  unknown(r, allowed, z);
  return ok(v, z);
};
