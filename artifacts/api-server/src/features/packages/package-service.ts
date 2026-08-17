import {
  addSpecialRequestInputSchema,
  configureBookingPackagesInputSchema,
  decideSpecialRequestInputSchema,
  type AddSpecialRequestInput,
  type ConfigureBookingPackagesInput,
  type DecideSpecialRequestInput,
} from "@/features/packages/package-input";
import {
  getAttractionTotalPolicy,
  packageAttributionForResource,
  validateSharedAttractionTotal,
} from "@/features/packages/package-policy";
import type {
  BookingSpecialRequest,
  PackageRepository,
  ReplacementAttribution,
} from "@/features/packages/package-repository";
import type { PackageTemplateSummary } from "@/features/packages/package-types";
import { err, ok, type Result } from "@/lib/result";

export type {
  AddSpecialRequestInput,
  BookingSpecialRequest,
  ConfigureBookingPackagesInput,
  DecideSpecialRequestInput,
};

export type PackageConfigurationError =
  | { code: "INVALID_PACKAGE_INPUT"; message: string }
  | { code: "BOOKING_NOT_FOUND" }
  | { code: "PACKAGE_TEMPLATE_NOT_FOUND" }
  | { code: "PACKAGE_TEMPLATE_INACTIVE" }
  | { code: "ASSIGNMENT_NOT_OWNED_BY_BOOKING" }
  | { code: "ATTRIBUTION_PACKAGE_NOT_SELECTED" }
  | { code: "TOTAL_REQUIRED" }
  | { code: "SPECIAL_REQUEST_NOT_PENDING" };

export type BookingPackageAttributionSummary = {
  bookingResourceAssignmentId: string;
  packageTemplateIds: string[];
  source: "inferred" | "manual";
};

export type BookingPackageSummary = {
  bookingId: string;
  packages: PackageTemplateSummary[];
  physicalAttractionTotal: number | null;
  attractionTotalApprovalReason: string | null;
  suggestedPhysicalAttractionTotal: number | null;
  attributions: BookingPackageAttributionSummary[];
};

type PackageServiceOptions = {
  now?: () => Date;
};

function invalidInput(message: string): Result<never, PackageConfigurationError> {
  return err({ code: "INVALID_PACKAGE_INPUT", message });
}

function requestSnapshot(request: BookingSpecialRequest) {
  return {
    bookingId: request.bookingId,
    description: request.description,
    treatment: request.treatment,
    approvalStatus: request.approvalStatus,
    decisionReason: request.decisionReason,
    decidedAt: request.decidedAt?.toISOString() ?? null,
  };
}

export class PackageService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: PackageRepository,
    options: PackageServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async configureBooking(
    input: ConfigureBookingPackagesInput,
  ): Promise<Result<BookingPackageSummary, PackageConfigurationError>> {
    const parsed = configureBookingPackagesInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(
        parsed.error.issues[0]?.message ?? "Review the package configuration.",
      );
    }

    return this.repository.transaction(async (transaction) => {
      const booking = await transaction.findBookingForUpdate(
        parsed.data.bookingId,
      );
      if (!booking) return err({ code: "BOOKING_NOT_FOUND" });

      const templateRecords = await transaction.findPackageTemplatesForShare(
        parsed.data.packageTemplateIds,
      );
      const templateById = new Map(
        templateRecords.map((template) => [template.id, template]),
      );
      if (
        parsed.data.packageTemplateIds.some(
          (packageTemplateId) => !templateById.has(packageTemplateId),
        )
      ) {
        return err({ code: "PACKAGE_TEMPLATE_NOT_FOUND" });
      }
      if (
        parsed.data.packageTemplateIds.some(
          (packageTemplateId) =>
            !templateById.get(packageTemplateId)?.active &&
            !booking.packageTemplateIds.includes(packageTemplateId),
        )
      ) {
        return err({ code: "PACKAGE_TEMPLATE_INACTIVE" });
      }
      const selectedTemplates = parsed.data.packageTemplateIds.map(
        (packageTemplateId) => templateById.get(packageTemplateId)!,
      );

      const totalValidation = validateSharedAttractionTotal({
        packages: selectedTemplates,
        physicalAttractionTotal: parsed.data.physicalAttractionTotal,
        approvalReason: parsed.data.attractionTotalApprovalReason,
      });
      if (!totalValidation.ok) return err(totalValidation.error);

      const assignments = await transaction.findBookingAssignmentsForUpdate(
        booking.id,
      );
      const assignmentById = new Map(
        assignments.map((assignment) => [assignment.id, assignment]),
      );
      if (
        parsed.data.manualAttributions.some(
          ({ bookingResourceAssignmentId }) =>
            !assignmentById.has(bookingResourceAssignmentId),
        )
      ) {
        return err({ code: "ASSIGNMENT_NOT_OWNED_BY_BOOKING" });
      }

      const selectedPackageIds = new Set(parsed.data.packageTemplateIds);
      if (
        parsed.data.manualAttributions.some(({ packageTemplateIds }) =>
          packageTemplateIds?.some(
            (packageTemplateId) => !selectedPackageIds.has(packageTemplateId),
          ),
        )
      ) {
        return err({ code: "ATTRIBUTION_PACKAGE_NOT_SELECTED" });
      }

      const manualByAssignment = new Map(
        parsed.data.manualAttributions.map((manual) => [
          manual.bookingResourceAssignmentId,
          manual.packageTemplateIds,
        ]),
      );
      const replacementAttributions: ReplacementAttribution[] =
        assignments.map((assignment) => {
          const hasManualInput = manualByAssignment.has(assignment.id);
          const manualPackageIds = hasManualInput
            ? manualByAssignment.get(assignment.id) ?? null
            : null;
          const attribution = packageAttributionForResource({
            selectedPackageIds: parsed.data.packageTemplateIds,
            resourcePackageIds: assignment.resourcePackageIds,
            manualPackageIds,
          });
          return {
            assignmentId: assignment.id,
            source: hasManualInput && manualPackageIds !== null
              ? "manual"
              : "inferred",
            packageTemplateIds: attribution.map(
              ({ packageTemplateId }) => packageTemplateId,
            ),
          };
        });

      await transaction.replacePackageSelections(
        booking.id,
        parsed.data.packageTemplateIds,
      );
      await transaction.replacePackageAttributions(
        booking.id,
        replacementAttributions,
      );
      await transaction.updateBookingAttractionTotal(
        booking.id,
        parsed.data.physicalAttractionTotal,
        parsed.data.attractionTotalApprovalReason,
      );

      const approvedAddCount =
        await transaction.countApprovedAddToCountRequests(booking.id);
      const baseSuggestion =
        getAttractionTotalPolicy(selectedTemplates).suggested;
      const suggestedPhysicalAttractionTotal =
        baseSuggestion === null ? null : baseSuggestion + approvedAddCount;

      await transaction.createAuditEntry({
        entityType: "booking",
        entityId: booking.id,
        action: "configure_packages",
        before: {
          packageTemplateIds: booking.packageTemplateIds,
          physicalAttractionTotal: booking.physicalAttractionTotal,
          attractionTotalApprovalReason:
            booking.attractionTotalApprovalReason,
          attributions: assignments.map((assignment) => ({
            bookingResourceAssignmentId: assignment.id,
            source: assignment.attributionSource,
            packageTemplateIds: assignment.attributedPackageIds,
          })),
        },
        after: {
          packageTemplateIds: parsed.data.packageTemplateIds,
          physicalAttractionTotal: parsed.data.physicalAttractionTotal,
          attractionTotalApprovalReason:
            parsed.data.attractionTotalApprovalReason,
          attributions: replacementAttributions.map((attribution) => ({
            bookingResourceAssignmentId: attribution.assignmentId,
            source: attribution.source,
            packageTemplateIds: attribution.packageTemplateIds,
          })),
        },
      });

      return ok({
        bookingId: booking.id,
        packages: selectedTemplates.map(
          ({ id, code, name, baseAttractionCount }) => ({
            id,
            code,
            name,
            baseAttractionCount,
          }),
        ),
        physicalAttractionTotal: parsed.data.physicalAttractionTotal,
        attractionTotalApprovalReason:
          parsed.data.attractionTotalApprovalReason,
        suggestedPhysicalAttractionTotal,
        attributions: replacementAttributions.map((attribution) => ({
          bookingResourceAssignmentId: attribution.assignmentId,
          packageTemplateIds: attribution.packageTemplateIds,
          source: attribution.source,
        })),
      });
    });
  }

  async addSpecialRequest(
    input: AddSpecialRequestInput,
  ): Promise<Result<BookingSpecialRequest, PackageConfigurationError>> {
    const parsed = addSpecialRequestInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(
        parsed.error.issues[0]?.message ?? "Review the special request.",
      );
    }

    return this.repository.transaction(async (transaction) => {
      const booking = await transaction.findBookingForUpdate(
        parsed.data.bookingId,
      );
      if (!booking) return err({ code: "BOOKING_NOT_FOUND" });

      const request = await transaction.createSpecialRequest(
        parsed.data,
        this.now(),
      );
      await transaction.createAuditEntry({
        entityType: "booking_special_request",
        entityId: request.id,
        action: "create",
        before: null,
        after: requestSnapshot(request),
      });
      return ok(request);
    });
  }

  async decideSpecialRequest(
    input: DecideSpecialRequestInput,
  ): Promise<Result<BookingSpecialRequest, PackageConfigurationError>> {
    const parsed = decideSpecialRequestInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(
        parsed.error.issues[0]?.message ?? "Review the request decision.",
      );
    }

    return this.repository.transaction(async (transaction) => {
      const request = await transaction.findSpecialRequestForUpdate(
        parsed.data.specialRequestId,
      );
      if (!request) return err({ code: "SPECIAL_REQUEST_NOT_PENDING" });

      const decided = await transaction.updateSpecialRequestDecision(
        request.id,
        parsed.data.decision,
        parsed.data.reason,
        this.now(),
      );
      if (!decided) return err({ code: "SPECIAL_REQUEST_NOT_PENDING" });

      await transaction.createAuditEntry({
        entityType: "booking_special_request",
        entityId: decided.id,
        action: "decision",
        before: requestSnapshot(request),
        after: requestSnapshot(decided),
      });
      return ok(decided);
    });
  }
}