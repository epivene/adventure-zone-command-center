import {
  acknowledgeResourceConflictInputSchema,
  configureBookingResourcesInputSchema,
  type AcknowledgeResourceConflictInput,
  type ConfigureBookingResourcesInput,
} from "@/features/resources/resource-input";
import {
  detectResourceConflicts,
  type TransferTimeLookup,
} from "@/features/resources/resource-conflicts";
import type {
  BookingResourceState,
  ResourceAssignmentRecord,
  ResourceConflictOverride,
  ResourceRecord,
  ResourceRepository,
  ResourceTransaction,
} from "@/features/resources/resource-repository";
import type {
  BookingResourceSummary,
  ResourceWarning,
} from "@/features/resources/resource-types";
import { err, ok, type Result } from "@/lib/result";

export type {
  AcknowledgeResourceConflictInput,
  BookingResourceSummary,
  ConfigureBookingResourcesInput,
};

export type ResourceError =
  | { code: "INVALID_RESOURCE_INPUT"; message: string }
  | { code: "BOOKING_NOT_FOUND" }
  | { code: "RESOURCE_NOT_FOUND" }
  | { code: "CONFLICT_NOT_FOUND" }
  | { code: "CONFLICT_ALREADY_ACKNOWLEDGED" };

type ResourceServiceOptions = {
  now?: () => Date;
};

function invalidInput(message: string): Result<never, ResourceError> {
  return err({ code: "INVALID_RESOURCE_INPUT", message });
}

function assignmentSnapshot(
  assignments: readonly ResourceAssignmentRecord[],
) {
  return [...assignments]
    .sort((first, second) => first.id.localeCompare(second.id))
    .map(({ id, resourceId, attributionSource }) => ({
      id,
      resourceId,
      attributionSource,
    }));
}

export function withResourceConflictOverrides(
  warnings: readonly ResourceWarning[],
  overrides: readonly ResourceConflictOverride[],
): ResourceWarning[] {
  const overrideByKey = new Map(
    overrides.map((override) => [override.conflictKey, override]),
  );
  return warnings.map((warning) => {
    if(warning.code === 'RESOURCE_DATE_EVIDENCE_UNRESOLVED') return {...warning,overridden:false,override:null};
    const override = overrideByKey.get(warning.conflictKey);
    return override
      ? {
          ...warning,
          overridden: true,
          override: {
            reason: override.reason,
            acknowledgedBy: override.acknowledgedBy,
            createdAt: override.createdAt,
          },
        }
      : warning;
  });
}

export async function summarizeBookingResources(input: {
  booking: BookingResourceState;
  assignments: readonly ResourceAssignmentRecord[];
  resources: readonly ResourceRecord[];
  reservations: readonly import("@/features/resources/resource-types").ResourceReservation[];
  overrides: readonly ResourceConflictOverride[];
  transferTimeLookup: TransferTimeLookup;
}): Promise<BookingResourceSummary> {
  const assignmentIds = new Set(input.assignments.map(({ id }) => id));
  const resourceIds = [
    ...new Set(input.assignments.map(({ resourceId }) => resourceId)),
  ];
  const resourceById = new Map(
    input.resources.map((resource) => [resource.id, resource]),
  );
  const assignedAttractionCount = resourceIds.filter(
    (resourceId) => resourceById.get(resourceId)?.countsAsAttraction,
  ).length;
  const globalWarnings = await detectResourceConflicts({
    reservations: input.reservations,
    physicalAttractionTotal: null,
    assignedAttractionCount,
    transferTimeLookup: input.transferTimeLookup,
  });
  const countWarnings = await detectResourceConflicts({
    reservations: input.reservations.filter(({ assignmentId }) =>
      assignmentIds.has(assignmentId),
    ),
    physicalAttractionTotal: input.booking.physicalAttractionTotal,
    assignedAttractionCount,
    transferTimeLookup: input.transferTimeLookup,
  });
  const detected = [
    ...countWarnings.filter(
      ({ code }) => code === "ATTRACTION_TOTAL_MISMATCH",
    ),
    ...globalWarnings,
  ];
  const relevantWarnings = detected.filter(
    (warning) =>
      warning.code === "ATTRACTION_TOTAL_MISMATCH" ||
      warning.assignmentIds.some((assignmentId) =>
        assignmentIds.has(assignmentId),
      ),
  );

  return {
    bookingId: input.booking.id,
    assignments: [...input.assignments]
      .sort((first, second) => first.id.localeCompare(second.id))
      .map((assignment) => {
        const resource = resourceById.get(assignment.resourceId);
        if (!resource) {
          throw new Error("An assigned resource disappeared while locked.");
        }
        return {
          id: assignment.id,
          resourceId: resource.id,
          resourceCode: resource.code,
          resourceName: resource.name,
          resourceStatus: resource.status,
          countsAsAttraction: resource.countsAsAttraction,
          attributionSource: assignment.attributionSource,
        };
      }),
    assignedAttractionCount,
    warnings: withResourceConflictOverrides(
      relevantWarnings,
      input.overrides,
    ),
  };
}

export class ResourceService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: ResourceRepository,
    private readonly transferTimeLookup: TransferTimeLookup,
    options: ResourceServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  private async summarize(
    transaction: ResourceTransaction,
    booking: BookingResourceState,
    assignments: readonly ResourceAssignmentRecord[],
    resources: readonly ResourceRecord[],
  ): Promise<BookingResourceSummary> {
    const resourceIds = [...new Set(assignments.map(({ resourceId }) => resourceId))];
    const reservations =
      await transaction.listReservationsForResources(resourceIds);
    const preliminary = await summarizeBookingResources({
      booking,
      assignments,
      resources,
      reservations,
      overrides: [],
      transferTimeLookup: this.transferTimeLookup,
    });
    const exactOverrides = preliminary.warnings.length === 0
      ? []
      : await transaction.listOverrides(
          booking.id,
          preliminary.warnings.map(({ conflictKey }) => conflictKey),
        );
    return {
      ...preliminary,
      warnings: withResourceConflictOverrides(
        preliminary.warnings,
        exactOverrides,
      ),
    };
  }

  async configureBookingAssignments(
    input: ConfigureBookingResourcesInput,
  ): Promise<Result<BookingResourceSummary, ResourceError>> {
    const parsed = configureBookingResourcesInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(
        parsed.error.issues[0]?.message ?? "Review the resource assignments.",
      );
    }

    return this.repository.transaction(async (transaction) => {
      const booking = await transaction.findBookingForUpdate(
        parsed.data.bookingId,
      );
      if (!booking) return err({ code: "BOOKING_NOT_FOUND" });

      const currentAssignments =
        await transaction.findCurrentAssignmentsForUpdate(booking.id);
      const lockedResourceIds = [
        ...new Set([
          ...parsed.data.resourceIds,
          ...currentAssignments.map(({ resourceId }) => resourceId),
        ]),
      ].sort((first, second) => first.localeCompare(second));
      const lockedResources =
        await transaction.findResourcesForUpdate(lockedResourceIds);
      const resourceById = new Map(
        lockedResources.map((resource) => [resource.id, resource]),
      );
      if (
        parsed.data.resourceIds.some(
          (resourceId) => !resourceById.has(resourceId),
        )
      ) {
        return err({ code: "RESOURCE_NOT_FOUND" });
      }

      const now = this.now();
      const assignments = await transaction.replaceBookingAssignments(
        booking.id,
        parsed.data.resourceIds,
        now,
      );
      const selectedResources = parsed.data.resourceIds.map(
        (resourceId) => resourceById.get(resourceId)!,
      );
      const summary = await this.summarize(
        transaction,
        booking,
        assignments,
        selectedResources,
      );

      await transaction.createAuditEntry({
        entityType: "booking",
        entityId: booking.id,
        action: "configure_resources",
        before: {
          assignments: assignmentSnapshot(currentAssignments),
        },
        after: {
          actorId: parsed.data.actorId,
          assignments: assignmentSnapshot(assignments),
          warningKeys: summary.warnings.map(({ conflictKey }) => conflictKey),
        },
      });
      return ok(summary);
    });
  }

  async acknowledgeConflict(
    input: AcknowledgeResourceConflictInput,
  ): Promise<Result<void, ResourceError>> {
    const parsed = acknowledgeResourceConflictInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(
        parsed.error.issues[0]?.message ?? "Review the conflict override.",
      );
    }

    return this.repository.transaction(async (transaction) => {
      const booking = await transaction.findBookingForUpdate(
        parsed.data.bookingId,
      );
      if (!booking) return err({ code: "BOOKING_NOT_FOUND" });
      const assignments =
        await transaction.findCurrentAssignmentsForUpdate(booking.id);
      const resourceIds = [
        ...new Set(assignments.map(({ resourceId }) => resourceId)),
      ].sort((first, second) => first.localeCompare(second));
      const resources = await transaction.findResourcesForUpdate(resourceIds);
      const summary = await this.summarize(
        transaction,
        booking,
        assignments,
        resources,
      );
      const conflict = summary.warnings.find(
        ({ conflictKey }) => conflictKey === parsed.data.conflictKey,
      );
      if (!conflict) return err({ code: "CONFLICT_NOT_FOUND" });
      if (conflict.overridden) {
        return err({ code: "CONFLICT_ALREADY_ACKNOWLEDGED" });
      }

      const now = this.now();
      const override = await transaction.createOverride(
        {
          bookingId: booking.id,
          resourceId: conflict.resourceId,
          conflictKey: conflict.conflictKey,
          reason: parsed.data.reason,
          acknowledgedBy: parsed.data.actorId,
        },
        now,
      );
      await transaction.createAuditEntry({
        entityType: "booking",
        entityId: booking.id,
        action: "acknowledge_resource_conflict",
        before: null,
        after: {
          conflictKey: override.conflictKey,
          resourceId: override.resourceId,
          reason: override.reason,
          actorId: override.acknowledgedBy,
          acknowledgedAt: override.createdAt.toISOString(),
        },
      });
      return ok(undefined);
    });
  }
}
