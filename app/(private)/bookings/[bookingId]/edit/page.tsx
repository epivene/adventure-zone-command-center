import Link from "next/link";
import { notFound } from "next/navigation";

import {
  acknowledgeResourceConflictAction,
  addBookingSpecialRequestAction,
  configureBookingPackagesAction,
  configureBookingResourcesAction,
  decideBookingSpecialRequestAction,
  updateBookingAction,
} from "@/app/(private)/bookings/actions";
import { BookingForm } from "@/components/bookings/booking-form";
import { PackageResourceEditor } from "@/components/bookings/package-resource-editor";
import { ResourceWarningList } from "@/components/bookings/resource-warning-list";
import { SpecialRequestEditor } from "@/components/bookings/special-request-editor";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { requireOwner } from "@/lib/auth/require-owner";
import { businessDateKey } from "@/lib/business-date";

export const dynamic = "force-dynamic";

async function loadBooking(bookingId: string) {
  await requireOwner();
  const { db } = await import("@/db/client");
  const repository = new DrizzleBookingRepository(db);
  const operationsProvider = createBookingOperationsSummaryProvider(db);
  const [detail, travelLegs, resourceSummary] = await Promise.all([
    repository.getBookingDetail(bookingId),
    new DrizzleTravelLegRepository(db).listTravelLegs(),
    operationsProvider.getResourceSummaryForBooking(bookingId),
  ]);
  const editorModel = detail
    ? await repository.getPackageResourceEditorModel(
        bookingId,
        resourceSummary?.warnings ?? [],
      )
    : null;
  return { detail, travelLegs, editorModel };
}

export default async function EditBookingPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const { detail, travelLegs, editorModel } = await loadBooking(bookingId);
  if (!detail || !editorModel) notFound();

  const updateAction = updateBookingAction.bind(null, bookingId);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header>
        <Link
          className="text-sm font-semibold text-slate-600 hover:text-orange-700"
          href={`/bookings/${bookingId}`}
        >
          ← Back to booking
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Booking details
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Edit {detail.booking.name}
        </h1>
        <p className="mt-2 text-slate-600">
          Update calendar dates, map location, travel-leg assignment, status,
          and notes. Active bookings keep their existing future follow-up plan.
        </p>
      </header>

      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <BookingForm
          draftKey={`booking:edit:${bookingId}`}
          initialValues={{
            name: detail.booking.name,
            venueName: detail.booking.venueName ?? "",
            address1: detail.booking.address1 ?? "",
            city: detail.booking.city,
            region: detail.booking.region,
            postalCode: detail.booking.postalCode ?? "",
            latitude: detail.booking.latitude?.toString() ?? "",
            longitude: detail.booking.longitude?.toString() ?? "",
            startsAt: detail.booking.startsAt
              ? businessDateKey(detail.booking.startsAt)
              : "",
            endsAt: detail.booking.endsAt
              ? businessDateKey(detail.booking.endsAt)
              : "",
            status: detail.booking.status,
            probability: detail.booking.probability,
            travelLegId: detail.booking.travelLegId ?? "",
            notes: detail.booking.notes ?? "",
          }}
          onSubmit={updateAction}
          successPath={`/bookings/${bookingId}`}
          travelLegs={travelLegs}
          variant="edit"
        />
      </section>
      <PackageResourceEditor
        configurePackages={configureBookingPackagesAction}
        configureResources={configureBookingResourcesAction}
        model={editorModel}
      />
      <SpecialRequestEditor
        addRequest={addBookingSpecialRequestAction}
        bookingId={bookingId}
        decideRequest={decideBookingSpecialRequestAction}
        requests={editorModel.specialRequests}
      />
      <ResourceWarningList
        acknowledge={acknowledgeResourceConflictAction}
        bookingId={bookingId}
        warnings={editorModel.warnings}
      />
    </div>
  );
}
