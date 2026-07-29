import { and, eq, inArray } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingPackageSelections,
  bookingResourceAssignments,
  bookingResourcePackageAttributions,
  bookingSpecialRequests,
  bookings,
  packageTemplates,
  resourcePackageTags,
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
    const [tags, attributions] = await Promise.all([
      this.database
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
        .where(inArray(bookingResourceAssignments.id, assignmentIds)),
      this.database
        .select()
        .from(bookingResourcePackageAttributions)
        .where(
          inArray(
            bookingResourcePackageAttributions.bookingResourceAssignmentId,
            assignmentIds,
          ),
        ),
    ]);

    return assignments.map((assignment) => ({
      id: assignment.id,
      bookingId: assignment.bookingId,
      attributionSource: assignment.attributionSource,
      resourcePackageIds: tags.flatMap((tag) =>
        tag.assignmentId === assignment.id && tag.packageTemplateId
          ? [tag.packageTemplateId]
          : [],
      ),
      attributedPackageIds: attributions.flatMap((attribution) =>
        attribution.bookingResourceAssignmentId === assignment.id
          ? [attribution.packageTemplateId]
          : [],
      ),
    }));
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

    const attributionRows = attributions.flatMap((attribution) =>
      attribution.packageTemplateIds.map((packageTemplateId) => ({
        bookingResourceAssignmentId: attribution.assignmentId,
        packageTemplateId,
      })),
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
