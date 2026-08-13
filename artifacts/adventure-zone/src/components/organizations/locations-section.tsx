import { Link } from "wouter";

import type {
  OrganizationHierarchyRollups,
  OrganizationLocationSummary,
} from "@/features/organizations/organization-repository";
import { normalizeExternalWebsite } from "@/features/organizations/website-url";

function formatDate(value: Date | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/Denver",
  }).format(value);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ");
}

function locationAddress(location: OrganizationLocationSummary) {
  return [
    location.address1,
    location.address2,
    location.city,
    location.region,
    location.postalCode,
  ].filter(Boolean).join(", ");
}

function WebsiteAction({ website }: { website: string | null }) {
  const href = normalizeExternalWebsite(website);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <span>Website: {website || "Not recorded"}</span>
      {href ? (
        <a
          className="button-secondary text-center"
          href={href}
          rel="noreferrer noopener"
          target="_blank"
        >
          Visit website
        </a>
      ) : null}
    </div>
  );
}

export function LocationsSection({
  locations,
  rollups,
}: {
  locations: OrganizationLocationSummary[];
  rollups: OrganizationHierarchyRollups;
}) {
  if (!locations.length) return null;

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-labelledby="locations-events-title"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold" id="locations-events-title">Locations &amp; Events</h2>
          <p className="mt-1 text-sm text-slate-600">
            {rollups.locationCount} location{rollups.locationCount === 1 ? "" : "s"} · {rollups.upcomingBookingCount} upcoming booking{rollups.upcomingBookingCount === 1 ? "" : "s"} · {rollups.overdueFollowUpCount} overdue follow-up{rollups.overdueFollowUpCount === 1 ? "" : "s"}
          </p>
        </div>
        {rollups.travelLegs.length ? (
          <p className="text-sm text-slate-600">
            Travel legs: {rollups.travelLegs.map((leg) => leg.name).join(", ")}
          </p>
        ) : null}
      </div>

      <ul className="mt-4 grid gap-3">
        {locations.map((location) => (
          <li className="rounded-lg border border-slate-200 p-4" key={location.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Link className="text-lg font-bold hover:text-orange-700" href={`/profiles/${location.id}`}>
                  {location.name}
                </Link>
                <p className="mt-1 text-sm text-slate-600">{locationAddress(location) || "Location not recorded"}</p>
                {location.localStatus ? <p className="mt-2 text-sm text-slate-700">Status: {titleCase(location.localStatus)}</p> : null}
                {location.nextBooking ? (
                  <>
                    <p className="mt-2 text-sm text-slate-700">
                      Next booking: <Link className="font-semibold hover:text-orange-700" href={`/bookings/${location.nextBooking.id}`}>{location.nextBooking.name}</Link>
                    </p>
                    <p className="text-sm text-slate-600">{formatDate(location.nextBooking.startsAt)} · {titleCase(location.nextBooking.status)}</p>
                  </>
                ) : null}
                {location.nextFollowUp ? (
                  <>
                    <p className="mt-2 text-sm text-slate-700">Next follow-up: {titleCase(location.nextFollowUp.kind)}</p>
                    <p className="text-sm text-slate-600">Due {formatDate(location.nextFollowUp.dueAt)}</p>
                  </>
                ) : null}
                {location.travelLeg ? (
                  <p className="mt-2 text-sm text-slate-700">Travel leg: {location.travelLeg.name}</p>
                ) : null}
                {location.primaryContactName ? (
                  <p className="mt-2 text-sm text-slate-700">Primary contact: {location.primaryContactName}</p>
                ) : null}
              </div>
              <WebsiteAction website={location.website} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
