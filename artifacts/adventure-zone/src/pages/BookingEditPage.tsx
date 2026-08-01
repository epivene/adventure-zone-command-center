import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { BookingForm } from "@/components/bookings/booking-form";
import { updateBookingAction } from "@/actions/bookings";
import { businessDateKey } from "@/lib/business-date";

export default function BookingEditPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) return;
    apiGet<any>(`/bookings/${bookingId}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [bookingId]);

  if (loading) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-slate-500">Loading…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Edit booking</h1>
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
        onSubmit={(input) => updateBookingAction(bookingId!, input)}
        successPath={`/bookings/${bookingId}`}
        travelLegs={data.allTravelLegs ?? []}
        variant="edit"
      />
    </div>
  );
}
