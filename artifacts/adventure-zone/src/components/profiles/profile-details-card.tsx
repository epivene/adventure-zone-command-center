import { useEffect, useState } from "react";

import { apiGet } from "@/lib/auth-token";
import { profileSummaryDetails } from "./profile-summary-details";

type Venue = {
  name: string;
  venueName?: string | null;
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  startsAt?: string | Date | null;
};

export function ProfileDetailsCard({ profile }: { profile: any }) {
  const [venue, setVenue] = useState<Venue | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<{ venue: Venue | null }>(`/event-profiles/${profile.id}/venue-summary`)
      .then((result) => { if (active) setVenue(result.venue ?? null); })
      .catch(() => { if (active) setVenue(null); });
    return () => { active = false; };
  }, [profile.id]);

  const details = profileSummaryDetails({
    place: profile.place ?? {},
    bookings: venue ? [venue] : [],
  });
  const description = String(profile.place?.description ?? "").trim();

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="profile-details-title">
      <h2 className="text-lg font-bold" id="profile-details-title">Profile details</h2>

      {description ? (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Description</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{description}</p>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="font-semibold text-slate-500">Mailing address</dt>
          <dd className="mt-1 whitespace-pre-line text-slate-800">{details.mailingAddress || "Not set"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Event / venue</dt>
          <dd className="mt-1 text-slate-800">
            {details.venueLabel ? <span className="block font-semibold">{details.venueLabel}</span> : null}
            <span className="whitespace-pre-line">{details.venueAddress || "Not set"}</span>
            {details.venueBookingName ? <span className="mt-1 block text-xs text-slate-500">From {details.venueBookingName}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Category</dt>
          <dd className="mt-1 capitalize text-slate-800">{profile.place?.placeType?.replaceAll("_", " ") || "Other"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Group</dt>
          <dd className="mt-1 text-slate-800">{profile.familyContext?.name || "Not grouped"}</dd>
        </div>
      </dl>
    </section>
  );
}
