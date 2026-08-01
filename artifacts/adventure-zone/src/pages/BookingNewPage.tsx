import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { BookingForm } from "@/components/bookings/booking-form";
import { createBookingAction } from "@/actions/bookings";

export default function BookingNewPage() {
  const [, navigate] = useLocation();
  const [travelLegs, setTravelLegs] = useState<any[]>([]);

  useEffect(() => {
    apiGet<any>("/routes/travel-legs")
      .then((d) => setTravelLegs(d ?? []))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Add lead</h1>
      <BookingForm
        travelLegs={travelLegs}
        onSubmit={async (input) => {
          const res = await createBookingAction(input);
          if (res.ok && res.bookingId) navigate(`/bookings/${res.bookingId}`);
          return res;
        }}
      />
    </div>
  );
}
