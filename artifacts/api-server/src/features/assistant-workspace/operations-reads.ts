import type { Queryable, RunContext, ToolResult } from "./contracts";
import { DrizzleTravelLegRepository } from "../routes/travel-leg-repository";
import { DrizzleResourceSettingsRepository } from "../resources/resource-repository";
import { createBookingOperationsSummaryProvider } from "../bookings/booking-operations-summary";
import { YearEndInspectionService } from "../year-end-inspections/inspection-service";
import { DrizzlePieceRepository } from "../year-end-inspections/piece-repository";
import { DrizzleOfficeTaskRepository } from "../office/office-task-repository";
const pick = (row: any, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
const limit = 200;
export function createOperationsReads(
  database: any,
  read: Queryable,
  ports = {
    legs: () =>
      new DrizzleTravelLegRepository(database).listTravelLegs({
        includeArchived: true,
      }),
    events: () => new DrizzleTravelLegRepository(database).listMapEvents(),
    legResources: () =>
      new DrizzleTravelLegRepository(database).listLegResources(),
    resources: () =>
      new DrizzleResourceSettingsRepository(database).listResources(),
    inspection: (id: string, year: number) =>
      new YearEndInspectionService(database).getForLegYear(id, year),
    pieces: (id: string) =>
      new DrizzlePieceRepository(database).list({
        legId: id,
        includeArchived: true,
      }),
    tasks: (id: string | null) =>
      new DrizzleOfficeTaskRepository(database).listForOwner(id),
    booking: () => createBookingOperationsSummaryProvider(database),
  },
) {
  const owner = (c: RunContext) => {
    if (c.actor.role !== "owner" || c.signal.aborted)
      throw new Error("ASSISTANT_ACCESS_DENIED");
  };
  const year = (c: RunContext, y: number) => {
    owner(c);
    if (!Number.isInteger(y) || y < 2000 || y > 2200)
      throw new Error("ASSISTANT_EVENT_YEAR_REQUIRED");
    if (c.selection.eventYear !== null && c.selection.eventYear !== y)
      throw new Error("ASSISTANT_EVENT_YEAR_MISMATCH");
  };
  const output = (
    view: string,
    id: string,
    eventYear: number | null,
    data: any,
    complete = true,
  ): ToolResult => ({
    status: complete ? "ok" : "partial",
    data: { view, ...data },
    evidence: [
      {
        id: `${view}:${id}`,
        kind: "profile",
        recordId: id,
        eventYear,
        occurredAt: null,
        retrievedAt: new Date().toISOString(),
        version: data.revision ?? null,
        complete,
        text: JSON.stringify(data),
      },
    ],
    receipts: [],
    code: complete ? null : "ASSISTANT_OPERATIONS_PARTIAL",
  });
  return {
    async list_legs(c: RunContext) {
      owner(c);
      const all = await ports.legs();
      return output(
        "operation_legs",
        "all",
        null,
        {
          legs: all
            .slice(0, limit)
            .map((x) =>
              pick(x, [
                "id",
                "name",
                "color",
                "archivedAt",
                "baseAddress",
                "defaultVehicleName",
                "defaultMpg",
              ]),
            ),
          truncated: all.length > limit,
        },
        all.length <= limit,
      );
    },
    async read_route_context(
      c: RunContext,
      args: { legId: string; eventYear: number },
    ) {
      year(c, args.eventYear);
      const leg = (await ports.legs()).find((x) => x.id === args.legId);
      if (!leg) throw new Error("ASSISTANT_LEG_NOT_FOUND");
      const selected = (await ports.events()).filter(
        (x) =>
          x.travelLegId === args.legId &&
          (x.seasonYear === args.eventYear || x.seasonYear === null),
      );
      const warnings = [
        "Route season is based on event dates; suggested legs are not assignments or availability promises.",
      ];
      if (selected.some((x) => !x.startsAt || !x.endsAt))
        warnings.push(
          "Some records have missing dates and cannot be assigned to a verified season.",
        );
      if (leg.archivedAt) warnings.push("This leg is archived.");
      return output(
        "route_context",
        args.legId,
        args.eventYear,
        {
          leg: pick(leg, ["id", "name", "archivedAt"]),
          events: selected
            .slice(0, limit)
            .map((x) =>
              pick(x, [
                "id",
                "organizationId",
                "name",
                "city",
                "region",
                "status",
                "probability",
                "travelLegId",
                "travelLegName",
                "travelLegAssignmentKind",
                "legAssignmentWarning",
                "legAssignmentExplanation",
                "startsAt",
                "endsAt",
                "routeBucket",
                "locationQuality",
                "locationLabel",
                "seasonYear",
              ]),
            ),
          resources: (await ports.legResources())
            .filter((x) => x.legId === args.legId)
            .slice(0, limit)
            .map((x) => pick(x, ["id", "code", "name", "category", "legId"])),
          warnings,
          truncated: selected.length > limit,
        },
        selected.length <= limit &&
          !selected.some((x) => !x.startsAt || !x.endsAt),
      );
    },
    async read_booking_operations(
      c: RunContext,
      args: { bookingId: string; eventYear: number },
    ) {
      year(c, args.eventYear);
      const booking = (
        await read.query(
          "SELECT b.id,b.organization_id,(SELECT CASE WHEN count(DISTINCT o.event_year)=1 THEN min(o.event_year) END FROM booking_opportunities o WHERE o.booking_id=b.id AND o.organization_id=b.organization_id) AS event_year FROM bookings b WHERE b.id=$1",
          [args.bookingId],
        )
      ).rows[0];
      if (
        !booking ||
        !c.selection.organizationIds.includes(booking.organization_id) ||
        (c.selection.bookingId && c.selection.bookingId !== booking.id)
      )
        throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
      if (booking.event_year !== args.eventYear)
        throw new Error("ASSISTANT_EVENT_YEAR_MISMATCH");
      const summary = await ports.booking().getForBooking(args.bookingId);
      return output("booking_operations", args.bookingId, args.eventYear, {
        bookingId: args.bookingId,
        packageNames: summary.packageNames,
        sharedAttractionTotal: summary.sharedAttractionTotal,
        pendingRequestCount: summary.pendingRequestCount,
        leg: summary.leg ? pick(summary.leg, ["id", "name", "color"]) : null,
        warnings: summary.warnings.map((x) =>
          pick(x, ["id", "kind", "severity", "message", "href"]),
        ),
        note: "Current cached/manual transfer estimates; no live route quote. Overrides remain warnings.",
      });
    },
    async read_resource_inventory(c: RunContext) {
      owner(c);
      const resources = await ports.resources();
      return output(
        "resource_inventory",
        "all",
        null,
        {
          resources: resources
            .slice(0, limit)
            .map((x) =>
              pick(x, [
                "id",
                "code",
                "name",
                "category",
                "countsAsAttraction",
                "movable",
                "setupMinutes",
                "teardownMinutes",
                "minimumTransferMinutes",
                "status",
                "normalTravelLegId",
                "packageTemplateIds",
              ]),
            ),
          warnings: [
            "Inventory status alone does not establish booking availability. Check booking operations for overlap and transfer conflicts.",
          ],
          truncated: resources.length > limit,
        },
        resources.length <= limit,
      );
    },
    async read_inspection_context(
      c: RunContext,
      args: { legId: string; inspectionYear: number },
    ) {
      owner(c);
      if (
        !Number.isInteger(args.inspectionYear) ||
        args.inspectionYear < 2000 ||
        args.inspectionYear > 2200
      )
        throw new Error("ASSISTANT_INSPECTION_YEAR_REQUIRED");
      if (!(await ports.legs()).some((x) => x.id === args.legId))
        throw new Error("ASSISTANT_LEG_NOT_FOUND");
      const record = await ports.inspection(args.legId, args.inspectionYear),
        pieces = await ports.pieces(args.legId);
      const inspection = record
        ? {
            ...pick(record, [
              "id",
              "legId",
              "inspectionYear",
              "status",
              "managerIdentitySnapshot",
              "overallNotes",
              "adminFollowUpNote",
              "startedAt",
              "completedAt",
              "updatedAt",
              "archivedAt",
              "progress",
            ]),
            entries: record.entries.slice(0, limit).map((x) => ({
              ...pick(x, [
                "id",
                "pieceId",
                "pieceCodeSnapshot",
                "pieceNameSnapshot",
                "resourceIdSnapshot",
                "resourceNameSnapshot",
                "entryState",
                "condition",
                "inspectionNotes",
                "repairNeeded",
                "repairNotes",
                "retainForFutureUse",
                "inspectedAt",
                "updatedAt",
              ]),
              maintenanceItem: x.maintenanceItem
                ? pick(x.maintenanceItem, [
                    "id",
                    "state",
                    "followUpNotes",
                    "resolutionNotes",
                    "createdAt",
                    "resolvedAt",
                  ])
                : null,
            })),
          }
        : null;
      return output(
        "inspection_context",
        args.legId,
        null,
        {
          inspectionYear: args.inspectionYear,
          inspection,
          currentPieces: pieces
            .slice(0, limit)
            .map((x) =>
              pick(x, [
                "id",
                "code",
                "name",
                "pieceType",
                "currentLegId",
                "lifecycleStatus",
                "currentResourceId",
                "currentResourceName",
                "updatedAt",
                "archivedAt",
              ]),
            ),
          warnings: [
            "Inspection entries are snapshots for the requested year; current inventory is shown separately.",
            "Photos have not been read. Resolved maintenance does not establish resource availability.",
            ...(record
              ? []
              : ["No saved inspection exists for this leg and year."]),
          ],
          truncated:
            pieces.length > limit || (record?.entries.length ?? 0) > limit,
        },
        !!record && pieces.length <= limit && record.entries.length <= limit,
      );
    },
    async read_staff_work(c: RunContext, args: { accountId: string | null }) {
      owner(c);
      const accounts = (
        await read.query(
          "SELECT id,display_name,role,enabled,updated_at FROM office_accounts WHERE ($1::uuid IS NULL OR id=$1) ORDER BY display_name LIMIT 201",
          [args.accountId],
        )
      ).rows;
      const tasks = await ports.tasks(args.accountId);
      const scoped = tasks.filter(
        (x) =>
          !c.selection.organizationIds.length ||
          !x.organizationId ||
          c.selection.organizationIds.includes(x.organizationId),
      );
      return output(
        "staff_work",
        args.accountId ?? "all",
        c.selection.eventYear,
        {
          accounts: accounts.slice(0, limit).map((x) => ({
            id: x.id,
            displayName: x.display_name,
            role: x.role,
            enabled: x.enabled,
            revision: new Date(x.updated_at).toISOString(),
          })),
          tasks: scoped.slice(0, limit).map((x) => ({
            ...pick(x, [
              "id",
              "officeAccountId",
              "taskType",
              "title",
              "instructions",
              "organizationId",
              "organizationName",
              "contactId",
              "status",
              "needsHelp",
              "coordinatorNote",
              "dueAt",
              "completedAt",
            ]),
            revision: x.updatedAt ? new Date(x.updatedAt).toISOString() : null,
          })),
          warnings: [
            "Office tasks do not have a canonical event year. Confirm event scope in the instructions.",
          ],
          truncated: accounts.length > limit || scoped.length > limit,
        },
        accounts.length <= limit && scoped.length <= limit,
      );
    },
  };
}
