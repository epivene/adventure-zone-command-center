import { and, asc, eq, inArray } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingPackageSelections,
  bookingResourceAssignments,
  bookingResourcePackageAttributions,
  bookingSpecialRequests,
  bookings,
  packageTemplates,
  resourcePackageTags,
  resources,
} from "@/db/schema";
import {
  recordAuditEntry,
  type AuditChange,
} from "@/features/audit/audit-service";
import type {
  PackageTemplateSummary,
  RequestApprovalStatus,
  SpecialRequestTreatment,
} from "@/features/packages/package-types";
import type { PackageTemplateInput } from "@/features/packages/package-input";

export type AuditEntry = AuditChange;

export type BookingPackageState = {
  id: string;
  physicalAttractionTotal: number | null;
  attractionTotalApprovalReason: string | null;
  packageTemplateIds: string[];
};

export type BookingResourceAssignmentPackageState = {
  id: string;
  bookingId: string;
  attributionSource: "inferred" | "manual";
  resourcePackageIds: string[];
  attributedPackageIds: string[];
};

export type PackageTemplateRecord = PackageTemplateSummary & {
  normalCapacity: number;
  temporaryUnavailableQuantity: number;
  active: boolean;
};

export type BookingSpecialRequest = {
  id: string;
  bookingId: string;
  description: string;
  treatment: SpecialRequestTreatment;
  approvalStatus: RequestApprovalStatus;
  decisionReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateSpecialRequestRecordInput = {
  bookingId: string;
  description: string;
  treatment: SpecialRequestTreatment;
};

export type ReplacementAttribution = {
  assignmentId: string;
  source: "inferred" | "manual";
  packageTemplateIds: string[];
};

export interface PackageTransaction {
  findBookingForUpdate(bookingId: string): Promise<BookingPackageState | null>;
  findPackageTemplatesForShare(
    packageTemplateIds: readonly string[],
  ): Promise<PackageTemplateRecord[]>;
  findBookingAssignmentsForUpdate(
    bookingId: string,
  ): Promise<BookingResourceAssignmentPackageState[]>;
  replacePackageSelections(
    bookingId: string,
    packageTemplateIds: readonly string[],
  ): Promise<void>;
  replacePackageAttributions(
    bookingId: string,
    attributions: readonly ReplacementAttribution[],
  ): Promise<void>;
  updateBookingAttractionTotal(
    bookingId: string,
    physicalAttractionTotal: number | null,
    attractionTotalApprovalReason: string | null,
  ): Promise<void>;
  countApprovedAddToCountRequests(bookingId: string): Promise<number>;
  createSpecialRequest(
    input: CreateSpecialRequestRecordInput,
    now: Date,
  ): Promise<BookingSpecialRequest>;
  findSpecialRequestForUpdate(
    specialRequestId: string,
  ): Promise<BookingSpecialRequest | null>;
  updateSpecialRequestDecision(
    specialRequestId: string,
    decision: "approved" | "declined",
    reason: string,
    now: Date,
  ): Promise<BookingSpecialRequest | null>;
  createAuditEntry(entry: AuditEntry): Promise<void>;
}

export interface PackageRepository {
  transaction<T>(
    operation: (transaction: PackageTransaction) => Promise<T>,
  ): Promise<T>;
}

type DrizzleDatabase = typeof database;
type DrizzlePackageWriter = Pick<
  DrizzleDatabase,
  "select" | "insert" | "update" | "delete"
>;

function toSpecialRequest(
  request: typeof bookingSpecialRequests.$inferSelect,
): BookingSpecialRequest {
  return {
    id: request.id,
    bookingId: request.bookingId,
    description: request.description,
    treatment: request.treatment,
    approvalStatus: request.approvalStatus,
    decisionReason: request.decisionReason,
    decidedAt: request.decidedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

class DrizzlePackageTransaction implements PackageTransaction {
  constructor(private readonly database: DrizzlePackageWriter) {}

  async findBookingForUpdate(
    bookingId: string,
  ): Promise<BookingPackageState | null> {
    const [booking] = await this.database
      .select({
        id: bookings.id,
        physicalAttractionTotal: bookings.physicalAttractionTotal,
        attractionTotalApprovalReason: bookings.attractionTotalApprovalReason,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update");
    if (!booking) return null;

    const selections = await this.database
      .select({ packageTemplateId: bookingPackageSelections.packageTemplateId })
      .from(bookingPackageSelections)
      .where(eq(bookingPackageSelections.bookingId, bookingId));

    return {
      ...booking,
      packageTemplateIds: selections.map(
        ({ packageTemplateId }) => packageTemplateId,
      ),
    };
  }

  async findPackageTemplatesForShare(
    packageTemplateIds: readonly string[],
  ): Promise<PackageTemplateRecord[]> {
    if (packageTemplateIds.length === 0) return [];
    const templates = await this.database
      .select()
      .from(packageTemplates)
      .where(inArray(packageTemplates.id, [...packageTemplateIds]))
      .for("share");
    return templates.map((template) => ({
      id: template.id,
      code: template.code,
      name: template.name,
      baseAttractionCount: template.baseAttractionCount,
      normalCapacity: template.normalCapacity,
      temporaryUnavailableQuantity: template.temporaryUnavailableQuantity,
      active: template.active,
    }));
  }

  async findBookingAssignmentsForUpdate(
    bookingId: string,
  ): Promise<BookingResourceAssignmentPackageState[]> {
    const assignments = await this.database
      .select()
      .from(bookingResourceAssignments)
      .where(eq(bookingResourceAssignments.bookingId, bookingId))
      .for("update");
    if (assignments.length === 0) return [];

    const assignmentIds = assignments.map(({ id }) => id);
    const resourceIds = [...new Set(assignments.map(({ resourceId }) => resourceId))]
      .sort((first, second) => first.localeCompare(second));
    await this.database
      .select({ id: resources.id })
      .from(resources)
      .where(inArray(resources.id, resourceIds))
      .orderBy(resources.id)
      .for("share");

    const selections = await this.database
      .select({ packageTemplateId: bookingPackageSelections.packageTemplateId })
      .from(bookingPackageSelections)
      .where(eq(bookingPackageSelections.bookingId, bookingId));
    const tags = await this.database
      .select({
        assignmentId: bookingResourceAssignments.id,
        packageTemplateId: resourcePackageTags.packageTemplateId,
      })
      .from(bookingResourceAssignments)
      .leftJoin(
        resourcePackageTags,
        eq(
          resourcePackageTags.resourceId,
          bookingResourceAssignments.resourceId,
        ),
      )
      .where(inArray(bookingResourceAssignments.id, assignmentIds));
    const attributions = await this.database
      .select()
      .from(bookingResourcePackageAttributions)
      .where(
        inArray(
          bookingResourcePackageAttributions.bookingResourceAssignmentId,
          assignmentIds,
        ),
      );
    const selectedPackageIds = new Set(
      selections.map(({ packageTemplateId }) => packageTemplateId),
    );

    return assignments.map((assignment) => {
      const resourcePackageIds = tags.flatMap((tag) =>
        tag.assignmentId === assignment.id && tag.packageTemplateId
          ? [tag.packageTemplateId]
          : [],
      );
      const persistedPackageIds = attributions.flatMap((attribution) =>
        attribution.bookingResourceAssignmentId === assignment.id
          ? [attribution.packageTemplateId]
          : [],
      );
      return {
        id: assignment.id,
        bookingId: assignment.bookingId,
        attributionSource: assignment.attributionSource,
        resourcePackageIds,
        attributedPackageIds: assignment.attributionSource === "manual"
          ? persistedPackageIds
          : resourcePackageIds.filter((packageTemplateId) =>
              selectedPackageIds.has(packageTemplateId)
            ),
      };
    });
  }

  async replacePackageSelections(
    bookingId: string,
    packageTemplateIds: readonly string[],
  ): Promise<void> {
    await this.database
      .delete(bookingPackageSelections)
      .where(eq(bookingPackageSelections.bookingId, bookingId));
    if (packageTemplateIds.length > 0) {
      await this.database.insert(bookingPackageSelections).values(
        packageTemplateIds.map((packageTemplateId) => ({
          bookingId,
          packageTemplateId,
        })),
      );
    }
  }

  async replacePackageAttributions(
    bookingId: string,
    attributions: readonly ReplacementAttribution[],
  ): Promise<void> {
    const assignmentIds = attributions.map(({ assignmentId }) => assignmentId);
    if (assignmentIds.length > 0) {
      const ownedAssignments = await this.database
        .select({ id: bookingResourceAssignments.id })
        .from(bookingResourceAssignments)
        .where(
          and(
            eq(bookingResourceAssignments.bookingId, bookingId),
            inArray(bookingResourceAssignments.id, assignmentIds),
          ),
        );
      if (ownedAssignments.length !== new Set(assignmentIds).size) {
        throw new Error("Package attribution includes a foreign assignment.");
      }
    }

    const selectedPackages = await this.database
      .select({ packageTemplateId: bookingPackageSelections.packageTemplateId })
      .from(bookingPackageSelections)
      .where(eq(bookingPackageSelections.bookingId, bookingId));
    const selectedPackageIds = new Set(
      selectedPackages.map(({ packageTemplateId }) => packageTemplateId),
    );
    if (
      attributions.some(({ packageTemplateIds }) =>
        packageTemplateIds.some(
          (packageTemplateId) => !selectedPackageIds.has(packageTemplateId),
        ),
      )
    ) {
      throw new Error("Package attribution includes an unselected package.");
    }

    const bookingAssignments = await this.database
      .select({ id: bookingResourceAssignments.id })
      .from(bookingResourceAssignments)
      .where(eq(bookingResourceAssignments.bookingId, bookingId));
    const bookingAssignmentIds = bookingAssignments.map(({ id }) => id);
    if (bookingAssignmentIds.length > 0) {
      await this.database
        .delete(bookingResourcePackageAttributions)
        .where(
          inArray(
            bookingResourcePackageAttributions.bookingResourceAssignmentId,
            bookingAssignmentIds,
          ),
        );
    }

    for (const attribution of attributions) {
      await this.database
        .update(bookingResourceAssignments)
        .set({ attributionSource: attribution.source, updatedAt: new Date() })
        .where(
          and(
            eq(bookingResourceAssignments.id, attribution.assignmentId),
            eq(bookingResourceAssignments.bookingId, bookingId),
          ),
        );
    }

    const attributionRows = attributions
      .filter(({ source }) => source === "manual")
      .flatMap((attribution) =>
        attribution.packageTemplateIds.map((packageTemplateId) => ({
          bookingResourceAssignmentId: attribution.assignmentId,
          packageTemplateId,
        }))
      );
    if (attributionRows.length > 0) {
      await this.database
        .insert(bookingResourcePackageAttributions)
        .values(attributionRows);
    }
  }

  async updateBookingAttractionTotal(
    bookingId: string,
    physicalAttractionTotal: number | null,
    attractionTotalApprovalReason: string | null,
  ): Promise<void> {
    const [updated] = await this.database
      .update(bookings)
      .set({
        physicalAttractionTotal,
        attractionTotalApprovalReason,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId))
      .returning({ id: bookings.id });
    if (!updated) throw new Error("Booking disappeared during configuration.");
  }

  async countApprovedAddToCountRequests(bookingId: string): Promise<number> {
    const requests = await this.database
      .select({ id: bookingSpecialRequests.id })
      .from(bookingSpecialRequests)
      .where(
        and(
          eq(bookingSpecialRequests.bookingId, bookingId),
          eq(bookingSpecialRequests.treatment, "add_to_count"),
          eq(bookingSpecialRequests.approvalStatus, "approved"),
        ),
      );
    return requests.length;
  }

  async createSpecialRequest(
    input: CreateSpecialRequestRecordInput,
    now: Date,
  ): Promise<BookingSpecialRequest> {
    const [request] = await this.database
      .insert(bookingSpecialRequests)
      .values({
        ...input,
        approvalStatus: "needs_approval",
        decisionReason: null,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!request) throw new Error("Could not create the special request.");
    return toSpecialRequest(request);
  }

  async findSpecialRequestForUpdate(
    specialRequestId: string,
  ): Promise<BookingSpecialRequest | null> {
    const [request] = await this.database
      .select()
      .from(bookingSpecialRequests)
      .where(
        and(
          eq(bookingSpecialRequests.id, specialRequestId),
          eq(bookingSpecialRequests.approvalStatus, "needs_approval"),
        ),
      )
      .limit(1)
      .for("update");
    return request ? toSpecialRequest(request) : null;
  }

  async updateSpecialRequestDecision(
    specialRequestId: string,
    decision: "approved" | "declined",
    reason: string,
    now: Date,
  ): Promise<BookingSpecialRequest | null> {
    const [request] = await this.database
      .update(bookingSpecialRequests)
      .set({
        approvalStatus: decision,
        decisionReason: reason,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(bookingSpecialRequests.id, specialRequestId),
          eq(bookingSpecialRequests.approvalStatus, "needs_approval"),
        ),
      )
      .returning();
    return request ? toSpecialRequest(request) : null;
  }

  createAuditEntry(entry: AuditEntry): Promise<void> {
    return recordAuditEntry(this.database, entry);
  }
}

export class DrizzlePackageRepository implements PackageRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  transaction<T>(
    operation: (transaction: PackageTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction((transaction) =>
      operation(new DrizzlePackageTransaction(transaction)),
    );
  }
}

export type PackageTemplateSettingsRecord = PackageTemplateRecord;

export type PackageSettingsErrorCode = "PACKAGE_TEMPLATE_NOT_FOUND";

export class PackageSettingsError extends Error {
  constructor(readonly code: PackageSettingsErrorCode) {
    super(code);
    this.name = "PackageSettingsError";
  }
}

export interface PackageSettingsRepository {
  listPackageTemplates(): Promise<PackageTemplateSettingsRecord[]>;
  updatePackageTemplate(
    input: PackageTemplateInput,
    actorId: string,
  ): Promise<PackageTemplateSettingsRecord>;
}

function packageSettingsSnapshot(
  template: PackageTemplateSettingsRecord,
) {
  return {
    code: template.code,
    name: template.name,
    baseAttractionCount: template.baseAttractionCount,
    active: template.active,
  };
}

export class DrizzlePackageSettingsRepository
implements PackageSettingsRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listPackageTemplates(): Promise<PackageTemplateSettingsRecord[]> {
    const records = await this.database
      .select({
        id: packageTemplates.id,
        code: packageTemplates.code,
        name: packageTemplates.name,
        baseAttractionCount: packageTemplates.baseAttractionCount,
        normalCapacity: packageTemplates.normalCapacity,
        temporaryUnavailableQuantity: packageTemplates.temporaryUnavailableQuantity,
        active: packageTemplates.active,
      })
      .from(packageTemplates)
      .orderBy(asc(packageTemplates.name), asc(packageTemplates.id));
    return records;
  }

  updatePackageTemplate(
    input: PackageTemplateInput,
    actorId: string,
  ): Promise<PackageTemplateSettingsRecord> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          id: packageTemplates.id,
          code: packageTemplates.code,
          name: packageTemplates.name,
          baseAttractionCount: packageTemplates.baseAttractionCount,
          normalCapacity: packageTemplates.normalCapacity,
          temporaryUnavailableQuantity: packageTemplates.temporaryUnavailableQuantity,
          active: packageTemplates.active,
        })
        .from(packageTemplates)
        .where(eq(packageTemplates.id, input.id))
        .limit(1)
        .for("update");
      if (!current) {
        throw new PackageSettingsError("PACKAGE_TEMPLATE_NOT_FOUND");
      }

      const [updated] = await transaction
        .update(packageTemplates)
        .set({
          name: input.name,
          baseAttractionCount: input.baseAttractionCount,
          normalCapacity: input.normalCapacity,
          temporaryUnavailableQuantity: input.temporaryUnavailableQuantity,
          active: input.active,
          updatedAt: new Date(),
        })
        .where(eq(packageTemplates.id, input.id))
        .returning({
          id: packageTemplates.id,
          code: packageTemplates.code,
          name: packageTemplates.name,
          baseAttractionCount: packageTemplates.baseAttractionCount,
          normalCapacity: packageTemplates.normalCapacity,
          temporaryUnavailableQuantity: packageTemplates.temporaryUnavailableQuantity,
          active: packageTemplates.active,
        });
      if (!updated) {
        throw new PackageSettingsError("PACKAGE_TEMPLATE_NOT_FOUND");
      }

      await recordAuditEntry(transaction, {
        entityType: "package_template",
        entityId: updated.id,
        action: "update",
        before: packageSettingsSnapshot(current),
        after: {
          ...packageSettingsSnapshot(updated),
          actorId,
        },
      });
      return updated;
    });
  }
}
