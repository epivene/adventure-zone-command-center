import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

export type PackageHistorySource = {
  bookingId: string;
  eventStartAt: string | null;
  label: string;
};

export type PackageHistorySignal =
  | {
      kind: "usual_package_mix";
      packageNames: string[];
      sourceBookingIds: string[];
    }
  | {
      kind: "main_attraction_difference";
      previousCount: number;
      currentCount: number;
      difference: number;
      sourceBookingId: string;
    }
  | {
      kind: "missing_prior_resource";
      resourceId: string;
      resourceName: string;
      sourceBookingId: string;
    }
  | {
      kind: "usual_event_month";
      month: number;
      sampleBookingIds: string[];
    };

export type PackageHistoryComparison = {
  currentBookingId: string;
  signals: PackageHistorySignal[];
  sources: PackageHistorySource[];
};

export type HistoricalBookingSnapshot = {
  id: string;
  label: string;
  startsAt: Date | null;
  physicalAttractionTotal: number | null;
  packageNames: string[];
  specialResources: Array<{ id: string; name: string }>;
};

function packageSetKey(names: readonly string[]): string {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en-US"))
    .join("|");
}

export function derivePackageHistoryComparison(input: {
  currentBookingId: string;
  currentPhysicalAttractionTotal: number | null;
  currentResourceIds: readonly string[];
  priorBookings: readonly HistoricalBookingSnapshot[];
}): PackageHistoryComparison {
  const priorBookings = [...input.priorBookings].sort((a, b) => {
    const aTime = a.startsAt?.getTime() ?? 0;
    const bTime = b.startsAt?.getTime() ?? 0;
    return bTime - aTime || b.id.localeCompare(a.id);
  });
  const sources: PackageHistorySource[] = priorBookings.map((booking) => ({
    bookingId: booking.id,
    eventStartAt: booking.startsAt?.toISOString() ?? null,
    label: booking.label,
  }));
  const signals: PackageHistorySignal[] = [];

  const mixes = new Map<string, { names: string[]; bookingIds: string[] }>();
  for (const booking of priorBookings) {
    const key = packageSetKey(booking.packageNames);
    if (!key) continue;
    const existing = mixes.get(key) ?? {
      names: [...new Set(booking.packageNames)].sort((a, b) => a.localeCompare(b, "en-US")),
      bookingIds: [],
    };
    existing.bookingIds.push(booking.id);
    mixes.set(key, existing);
  }
  const repeatedMix = [...mixes.values()]
    .filter((mix) => mix.bookingIds.length >= 2)
    .sort((a, b) => b.bookingIds.length - a.bookingIds.length)[0];
  const fallbackMix = priorBookings.length < 2
    ? [...mixes.values()][0]
    : undefined;
  const usualMix = repeatedMix ?? fallbackMix;
  if (usualMix) {
    signals.push({
      kind: "usual_package_mix",
      packageNames: usualMix.names,
      sourceBookingIds: usualMix.bookingIds,
    });
  }

  if (input.currentPhysicalAttractionTotal !== null) {
    const priorWithTotal = priorBookings.find(
      (booking) => booking.physicalAttractionTotal !== null,
    );
    if (priorWithTotal && priorWithTotal.physicalAttractionTotal !== null) {
      const previousCount = priorWithTotal.physicalAttractionTotal;
      signals.push({
        kind: "main_attraction_difference",
        previousCount,
        currentCount: input.currentPhysicalAttractionTotal,
        difference: input.currentPhysicalAttractionTotal - previousCount,
        sourceBookingId: priorWithTotal.id,
      });
    }
  }

  const latest = priorBookings[0];
  if (latest) {
    const currentResourceIds = new Set(input.currentResourceIds);
    for (const resource of latest.specialResources) {
      if (!currentResourceIds.has(resource.id)) {
        signals.push({
          kind: "missing_prior_resource",
          resourceId: resource.id,
          resourceName: resource.name,
          sourceBookingId: latest.id,
        });
      }
    }
  }

  const months = new Map<number, string[]>();
  for (const booking of priorBookings) {
    if (!booking.startsAt) continue;
    const month = booking.startsAt.getUTCMonth() + 1;
    const ids = months.get(month) ?? [];
    ids.push(booking.id);
    months.set(month, ids);
  }
  const usualMonth = [...months.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0];
  if (usualMonth) {
    signals.push({
      kind: "usual_event_month",
      month: usualMonth[0],
      sampleBookingIds: usualMonth[1],
    });
  }

  return { currentBookingId: input.currentBookingId, signals, sources };
}

export class PackageHistoryRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async compareBooking(bookingId: string): Promise<PackageHistoryComparison | null> {
    const currentResult = await this.pool.query(
      `SELECT id, organization_id, physical_attraction_total
       FROM bookings
       WHERE id = $1`,
      [bookingId],
    );
    const current = currentResult.rows[0];
    if (!current) return null;
    if (!current.organization_id) {
      return {
        currentBookingId: bookingId,
        signals: [],
        sources: [],
      };
    }

    const familyResult = await this.pool.query(
      `SELECT family_id FROM event_family_members WHERE organization_id = $1`,
      [current.organization_id],
    );
    const familyId = familyResult.rows[0]?.family_id as string | undefined;

    const priorResult = familyId
      ? await this.pool.query(
          `SELECT b.id, b.name, b.starts_at, b.physical_attraction_total
           FROM bookings b
           JOIN event_family_members efm ON efm.organization_id = b.organization_id
           WHERE efm.family_id = $1
             AND b.id <> $2
             AND b.status NOT IN ('cancelled', 'declined')
           ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
           LIMIT 12`,
          [familyId, bookingId],
        )
      : await this.pool.query(
          `SELECT b.id, b.name, b.starts_at, b.physical_attraction_total
           FROM bookings b
           WHERE b.organization_id = $1
             AND b.id <> $2
             AND b.status NOT IN ('cancelled', 'declined')
           ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
           LIMIT 12`,
          [current.organization_id, bookingId],
        );

    const priorIds = priorResult.rows.map((row) => row.id as string);
    const currentResourcesResult = await this.pool.query(
      `SELECT resource_id FROM booking_resource_assignments WHERE booking_id = $1`,
      [bookingId],
    );
    if (priorIds.length === 0) {
      return derivePackageHistoryComparison({
        currentBookingId: bookingId,
        currentPhysicalAttractionTotal: current.physical_attraction_total,
        currentResourceIds: currentResourcesResult.rows.map((row) => row.resource_id),
        priorBookings: [],
      });
    }

    const [packageResult, resourceResult] = await Promise.all([
      this.pool.query(
        `SELECT bps.booking_id, pt.name
         FROM booking_package_selections bps
         JOIN package_templates pt ON pt.id = bps.package_template_id
         WHERE bps.booking_id = ANY($1::uuid[])
         ORDER BY pt.name`,
        [priorIds],
      ),
      this.pool.query(
        `SELECT bra.booking_id, r.id, r.name
         FROM booking_resource_assignments bra
         JOIN resources r ON r.id = bra.resource_id
         WHERE bra.booking_id = ANY($1::uuid[])
           AND r.package_count_category = 'special_shared'
         ORDER BY r.name`,
        [priorIds],
      ),
    ]);

    const priorBookings: HistoricalBookingSnapshot[] = priorResult.rows.map((row) => ({
      id: row.id,
      label: row.name,
      startsAt: row.starts_at ? new Date(row.starts_at) : null,
      physicalAttractionTotal: row.physical_attraction_total,
      packageNames: packageResult.rows
        .filter((packageRow) => packageRow.booking_id === row.id)
        .map((packageRow) => packageRow.name),
      specialResources: resourceResult.rows
        .filter((resourceRow) => resourceRow.booking_id === row.id)
        .map((resourceRow) => ({ id: resourceRow.id, name: resourceRow.name })),
    }));

    return derivePackageHistoryComparison({
      currentBookingId: bookingId,
      currentPhysicalAttractionTotal: current.physical_attraction_total,
      currentResourceIds: currentResourcesResult.rows.map((row) => row.resource_id),
      priorBookings,
    });
  }
}
