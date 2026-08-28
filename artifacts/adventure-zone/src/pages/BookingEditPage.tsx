import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { BookingForm } from "@/components/bookings/booking-form";
import { PackageResourceEditor } from "@/components/bookings/package-resource-editor";
import { LegAssignmentPanel } from "@/components/bookings/leg-assignment-panel";
import {
  configureBookingPackagesAction,
  configureBookingResourcesAction,
  updateBookingAction,
} from "@/actions/bookings";
import { businessDateKey } from "@/lib/business-date";
import type { BookingPackageResourceEditorModel } from "@/features/bookings/booking-repository";

export default function BookingEditPage({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<any>(null);
  const [packageModel, setPackageModel] =
    useState<BookingPackageResourceEditorModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadPackageModel = useCallback(async () => {
    const model = await apiGet<BookingPackageResourceEditorModel>(
      `/bookings/${bookingId}/package-editor`,
    );
    setPackageModel(model);
  }, [bookingId]);

  useEffect(() => {
    Promise.all([
      apiGet<any>(`/bookings/${bookingId}`),
      apiGet<BookingPackageResourceEditorModel>(
        `/bookings/${bookingId}/package-editor`,
      ),
    ])
      .then(([bookingData, model]) => {
        setData(bookingData);
        setPackageModel(model);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [bookingId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl">
        <p className="mt-8 text-slate-500">Loading…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <p className="mt-8 text-rose-700">{error ?? "Not found"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-8">
      <section className="max-w-2xl">
        <h1 className="mb-8 text-3xl font-bold tracking-tight">Edit booking</h1>
        <LegAssignmentPanel
          assignment={data.legAssignment}
          travelLegs={data.allTravelLegs ?? []}
        />
        <BookingForm
          draftKey={`booking:edit:${bookingId}`}
          initialValues={{
            name: data.booking.name,
            venueName: data.booking.venueName ?? "",
            address1: data.booking.address1 ?? "",
            city: data.booking.city,
            region: data.booking.region,
            postalCode: data.booking.postalCode ?? "",
            latitude: data.booking.latitude?.toString() ?? "",
            longitude: data.booking.longitude?.toString() ?? "",
            startsAt: data.booking.startsAt
              ? businessDateKey(new Date(data.booking.startsAt))
              : "",
            endsAt: data.booking.endsAt
              ? businessDateKey(new Date(data.booking.endsAt))
              : "",
            status: data.booking.status,
            probability: data.booking.probability,
            travelLegId: data.booking.travelLegId ?? "",
            notes: data.booking.notes ?? "",
          }}
          onSubmit={(input) => updateBookingAction(bookingId, input)}
          successPath={`/bookings/${bookingId}`}
          travelLegs={data.allTravelLegs ?? []}
          variant="edit"
        />
      </section>

      <section className="grid gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-orange-700">
            Event setup
          </p>
          <h2 className="mt-1 text-2xl font-bold">Packages &amp; equipment</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Use package ranges as the normal starting point, then customize the
            actual attractions, games, and shared equipment for this event.
          </p>
        </div>

        {packageModel ? (
          <PackageResourceEditor
            configurePackages={async (input) => {
              const result = await configureBookingPackagesAction(input);
              if (result.ok) await reloadPackageModel();
              return result;
            }}
            configureResources={async (input) => {
              const result = await configureBookingResourcesAction(input);
              if (result.ok) await reloadPackageModel();
              return result;
            }}
            model={packageModel}
          />
        ) : (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Package setup is unavailable for this booking.
          </p>
        )}
      </section>
    </div>
  );
}
