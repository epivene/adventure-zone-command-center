"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  bookingEditInputSchema,
  bookingInputSchema,
  type BookingEditInput,
  type BookingFormInput,
} from "@/features/bookings/booking-input";
import {
  BookingEditInvariantError,
  DrizzleBookingRepository,
} from "@/features/bookings/booking-repository";
import {
  BookingService,
  type CompleteFollowUpInput,
} from "@/features/bookings/booking-service";
import { followUpCompletionInputSchema } from "@/features/bookings/follow-up-completion-input";
import { requireOwner } from "@/lib/auth/require-owner";
import { err } from "@/lib/result";
import {
  addSpecialRequestInputSchema,
  configureBookingPackagesInputSchema,
  decideSpecialRequestInputSchema,
  type AddSpecialRequestInput,
  type ConfigureBookingPackagesInput,
  type DecideSpecialRequestInput,
} from "@/features/packages/package-input";
import {
  DrizzlePackageRepository,
} from "@/features/packages/package-repository";
import {
  PackageService,
  type PackageConfigurationError,
} from "@/features/packages/package-service";
import { DrizzleResourceRepository } from "@/features/resources/resource-repository";
import {
  ResourceService,
  type ResourceError,
} from "@/features/resources/resource-service";
import { unavailableTransferTimeLookup } from "@/features/bookings/booking-operations-summary";

async function createBookingService() {
  const { db } = await import("@/db/client");
  return new BookingService(new DrizzleBookingRepository(db));
}

export type BookingActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type ConfigureBookingResourcesActionInput = {
  bookingId: string;
  resourceIds: string[];
};

export type AcknowledgeResourceConflictActionInput = {
  bookingId: string;
  conflictKey: string;
  reason: string;
};

const actionUuid = z.uuid().transform((value) => value.toLowerCase());
const publicConfigureResourcesSchema = z
  .object({
    bookingId: actionUuid,
    resourceIds: z.array(actionUuid),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.resourceIds).size !== input.resourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Choose each resource only once.",
      });
    }
  });
const publicAcknowledgeConflictSchema = z
  .object({
    bookingId: actionUuid,
    conflictKey: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })
  .strict();

function revalidateBookingOperations(bookingId: string) {
  for (const path of [
    "/bookings",
    `/bookings/${bookingId}`,
    `/bookings/${bookingId}/edit`,
    "/today",
    "/calls/new",
    "/routes",
  ]) {
    revalidatePath(path);
  }
}

const packageErrorMessages: Record<
  PackageConfigurationError["code"],
  string
> = {
  INVALID_PACKAGE_INPUT: "Review the package configuration.",
  BOOKING_NOT_FOUND: "This booking could not be found.",
  PACKAGE_TEMPLATE_NOT_FOUND: "One of the selected packages no longer exists.",
  PACKAGE_TEMPLATE_INACTIVE:
    "Inactive packages can only be retained when already selected.",
  ASSIGNMENT_NOT_OWNED_BY_BOOKING:
    "A resource assignment changed. Refresh and review package attribution.",
  ATTRIBUTION_PACKAGE_NOT_SELECTED:
    "Resource attribution can use only selected packages.",
  TOTAL_REQUIRED: "Enter the shared physical attraction total.",
  APPROVAL_REASON_REQUIRED:
    "Add an approval reason for an attraction total outside the usual range.",
  SPECIAL_REQUEST_NOT_PENDING:
    "This request was already decided. Refresh to see its current status.",
};

const resourceErrorMessages: Record<ResourceError["code"], string> = {
  INVALID_RESOURCE_INPUT: "Review the resource assignments.",
  BOOKING_NOT_FOUND: "This booking could not be found.",
  RESOURCE_NOT_FOUND: "One of the selected resources no longer exists.",
  CONFLICT_NOT_FOUND:
    "This conflict changed. Refresh and review the current warning.",
  CONFLICT_ALREADY_ACKNOWLEDGED:
    "This conflict was already overridden. Refresh to see its details.",
};

function packageFailure(error: PackageConfigurationError): BookingActionResult {
  return { ok: false, error: packageErrorMessages[error.code] };
}

function resourceFailure(error: ResourceError): BookingActionResult {
  return { ok: false, error: resourceErrorMessages[error.code] };
}

export async function configureBookingPackagesAction(
  input: ConfigureBookingPackagesInput,
): Promise<BookingActionResult> {
  await requireOwner();
  const parsed = configureBookingPackagesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the package configuration." };
  }
  const { db } = await import("@/db/client");
  try {
    const result = await new PackageService(
      new DrizzlePackageRepository(db),
    ).configureBooking(parsed.data);
    if (!result.ok) return packageFailure(result.error);
  } catch {
    return { ok: false, error: "The package setup could not be saved. Try again." };
  }
  revalidateBookingOperations(parsed.data.bookingId);
  return { ok: true };
}

export async function addBookingSpecialRequestAction(
  input: AddSpecialRequestInput,
): Promise<BookingActionResult> {
  await requireOwner();
  const parsed = addSpecialRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Describe the request and choose its count treatment." };
  }
  const { db } = await import("@/db/client");
  try {
    const result = await new PackageService(
      new DrizzlePackageRepository(db),
    ).addSpecialRequest(parsed.data);
    if (!result.ok) return packageFailure(result.error);
  } catch {
    return { ok: false, error: "The special request could not be added. Try again." };
  }
  revalidateBookingOperations(parsed.data.bookingId);
  return { ok: true };
}

export async function decideBookingSpecialRequestAction(
  input: DecideSpecialRequestInput,
): Promise<BookingActionResult> {
  await requireOwner();
  const parsed = decideSpecialRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose a decision and add a reason." };
  }
  const { db } = await import("@/db/client");
  let bookingId: string;
  try {
    const result = await new PackageService(
      new DrizzlePackageRepository(db),
    ).decideSpecialRequest(parsed.data);
    if (!result.ok) return packageFailure(result.error);
    bookingId = result.value.bookingId;
  } catch {
    return { ok: false, error: "The request decision could not be saved. Try again." };
  }
  revalidateBookingOperations(bookingId);
  return { ok: true };
}

export async function configureBookingResourcesAction(
  input: ConfigureBookingResourcesActionInput,
): Promise<BookingActionResult> {
  const actor = await requireOwner();
  const parsed = publicConfigureResourcesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the resource assignments." };
  }
  const { db } = await import("@/db/client");
  try {
    const result = await new ResourceService(
      new DrizzleResourceRepository(db),
      unavailableTransferTimeLookup,
    ).configureBookingAssignments({ ...parsed.data, actorId: actor.userId });
    if (!result.ok) return resourceFailure(result.error);
  } catch {
    return { ok: false, error: "The resource assignments could not be saved. Try again." };
  }
  revalidateBookingOperations(parsed.data.bookingId);
  return { ok: true };
}

export async function acknowledgeResourceConflictAction(
  input: AcknowledgeResourceConflictActionInput,
): Promise<BookingActionResult> {
  const actor = await requireOwner();
  const parsed = publicAcknowledgeConflictSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Choose a current conflict and add an override reason." };
  }
  const { db } = await import("@/db/client");
  try {
    const result = await new ResourceService(
      new DrizzleResourceRepository(db),
      unavailableTransferTimeLookup,
    ).acknowledgeConflict({ ...parsed.data, actorId: actor.userId });
    if (!result.ok) return resourceFailure(result.error);
  } catch {
    return { ok: false, error: "The conflict override could not be saved. Try again." };
  }
  revalidateBookingOperations(parsed.data.bookingId);
  return { ok: true };
}

export async function createBookingAction(
  input: BookingFormInput,
): Promise<BookingActionResult> {
  await requireOwner();
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the highlighted booking fields." };
  }

  const service = await createBookingService();
  try {
    await service.createBooking({
      name: parsed.data.name,
      city: parsed.data.city,
      region: parsed.data.region,
      status: parsed.data.status,
      probability: parsed.data.probability,
      nextAction:
        parsed.data.nextActionKind && parsed.data.nextActionDueAt
          ? {
              kind: parsed.data.nextActionKind,
              dueAt: parsed.data.nextActionDueAt,
            }
          : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_ACTION_REQUIRED") {
      return {
        ok: false,
        error: "Choose a future next-action date for this active lead.",
      };
    }
    throw error;
  }

  revalidatePath("/bookings");
  return { ok: true };
}

export async function updateBookingAction(
  bookingId: string,
  input: BookingEditInput,
): Promise<BookingActionResult> {
  await requireOwner();
  const parsed = bookingEditInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Review the highlighted booking fields." };
  }

  const { db } = await import("@/db/client");
  let updated;
  try {
    updated = await new DrizzleBookingRepository(db).updateBookingDetails(
      bookingId,
      parsed.data,
    );
  } catch (error) {
    if (error instanceof BookingEditInvariantError) {
      return {
        ok: false,
        error:
          "This active booking needs an incomplete future follow-up before it can be edited.",
      };
    }
    throw error;
  }
  if (!updated) return { ok: false, error: "This booking could not be found." };

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath(`/bookings/${bookingId}/edit`);
  revalidatePath("/calendar");
  revalidatePath("/today");
  revalidatePath("/calls/new");
  revalidatePath("/routes");
  return { ok: true };
}

export async function completeFollowUpAction(input: CompleteFollowUpInput) {
  await requireOwner();
  const parsed = followUpCompletionInputSchema.safeParse(input);
  if (!parsed.success) {
    return err({ code: "INVALID_COMPLETION_INPUT" as const });
  }

  const service = await createBookingService();
  const result = await service.completeFollowUp(parsed.data);

  if (result.ok) {
    revalidateBookingOperations(result.value.bookingId);
  }

  return result;
}
