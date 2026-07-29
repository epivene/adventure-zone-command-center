import Link from "next/link";
import { notFound } from "next/navigation";

import {
  createActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
} from "@/app/(private)/activities/actions";
import { setLastResortAction } from "@/app/(private)/organizations/actions";
import { ActivityTimeline } from "@/components/activities/activity-timeline";
import { LastResortControl } from "@/components/organizations/last-resort-control";
import { LastResortWarning } from "@/components/organizations/last-resort-warning";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import { organizationIdSchema } from "@/features/organizations/last-resort-input";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
}

function positivePage(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const page = Number(candidate);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function organizationHref(
  organizationId: string,
  contactPage: number,
  bookingPage: number,
) {
  const query = new URLSearchParams();
  if (contactPage > 1) query.set("contactPage", String(contactPage));
  if (bookingPage > 1) query.set("bookingPage", String(bookingPage));
  const serialized = query.toString();
  return `/organizations/${organizationId}${serialized ? `?${serialized}` : ""}`;
}

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    contactPage?: string | string[];
    bookingPage?: string | string[];
  }>;
}) {
  await requireOwner();
  const { organizationId } = await params;
  const query = await searchParams;
  const requestedContactPage = positivePage(query.contactPage);
  const requestedBookingPage = positivePage(query.bookingPage);
  if (!organizationIdSchema.safeParse(organizationId).success) notFound();
  const { db } = await import("@/db/client");
  const organization = await new DrizzleOrganizationRepository(db).getOrganizationSummary(
    organizationId,
    {
      contactPage: requestedContactPage,
      bookingPage: requestedBookingPage,
      pageSize: 25,
    },
  );
  if (!organization) notFound();
  const timeline = await new ActivityService(
    new DrizzleActivityRepository(db),
  ).listTimeline({ organizationId });

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header>
        <Link className="text-sm font-semibold text-slate-600 hover:text-orange-700" href="/organizations">
          ← Back to organizations
        </Link>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{organization.name}</h1>
            <p className="mt-2 text-slate-600">
              Last changed {formatDate(organization.lastResortChangedAt)}
            </p>
          </div>
          <Link
            className="button-secondary text-center"
            href={`/calls/new?organizationId=${organization.id}`}
          >
            Call Workspace
          </Link>
        </div>
      </header>

      {organization.lastResort ? (
        <LastResortWarning
          organizationName={organization.name}
          reason={organization.lastResortReason}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <LastResortControl
          isLastResort={organization.lastResort}
          lastResortReason={organization.lastResortReason}
          onSubmit={setLastResortAction}
          organizationId={organization.id}
        />
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Associated contacts</h2>
          <p className="mt-1 text-sm text-slate-600">
            Showing {organization.contacts.length} of{" "}
            {organization.contactTotal ?? organization.contacts.length}
          </p>
          {organization.contacts.length ? (
            <ul className="mt-4 divide-y divide-slate-200">
              {organization.contacts.map((contact) => (
                <li className="py-3" key={contact.id}>
                  <Link className="font-semibold hover:text-orange-700" href={`/contacts/${contact.id}`}>
                    {contact.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-600">No contacts are associated with this account.</p>
          )}
          {(organization.contactPageCount ?? 1) > 1 ? (
            <nav
              aria-label="Associated contact pages"
              className="mt-4 flex items-center justify-between gap-3 text-sm"
            >
              <span>
                Page {organization.contactPage} of {organization.contactPageCount}
              </span>
              <div className="flex gap-3">
                {(organization.contactPage ?? 1) > 1 ? (
                  <Link
                    className="link"
                    href={organizationHref(
                      organization.id,
                      (organization.contactPage ?? 1) - 1,
                      organization.bookingPage ?? 1,
                    )}
                  >
                    Previous contacts
                  </Link>
                ) : null}
                {(organization.contactPage ?? 1) <
                (organization.contactPageCount ?? 1) ? (
                  <Link
                    className="link"
                    href={organizationHref(
                      organization.id,
                      (organization.contactPage ?? 1) + 1,
                      organization.bookingPage ?? 1,
                    )}
                  >
                    Next contacts
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-bold">Associated bookings</h2>
          <p className="mt-1 text-sm text-slate-600">
            Showing {organization.bookings.length} of{" "}
            {organization.bookingTotal ?? organization.bookings.length}
          </p>
          {organization.bookings.length ? (
            <ul className="mt-4 divide-y divide-slate-200">
              {organization.bookings.map((booking) => (
                <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={booking.id}>
                  <Link className="font-semibold hover:text-orange-700" href={`/bookings/${booking.id}`}>
                    {booking.name}
                  </Link>
                  <span className="text-sm text-slate-600">
                    {booking.travelLeg ? booking.travelLeg.name : "No travel leg"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-600">No bookings are associated with this account.</p>
          )}
          {(organization.bookingPageCount ?? 1) > 1 ? (
            <nav
              aria-label="Associated booking pages"
              className="mt-4 flex items-center justify-between gap-3 text-sm"
            >
              <span>
                Page {organization.bookingPage} of {organization.bookingPageCount}
              </span>
              <div className="flex gap-3">
                {(organization.bookingPage ?? 1) > 1 ? (
                  <Link
                    className="link"
                    href={organizationHref(
                      organization.id,
                      organization.contactPage ?? 1,
                      (organization.bookingPage ?? 1) - 1,
                    )}
                  >
                    Previous bookings
                  </Link>
                ) : null}
                {(organization.bookingPage ?? 1) <
                (organization.bookingPageCount ?? 1) ? (
                  <Link
                    className="link"
                    href={organizationHref(
                      organization.id,
                      organization.contactPage ?? 1,
                      (organization.bookingPage ?? 1) + 1,
                    )}
                  >
                    Next bookings
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-bold">Recent activity</h2>
          <div className="mt-4">
            <ActivityTimeline
              activities={timeline}
              createActivity={createActivityAction}
              editActivity={editActivityAction}
              loadRevisions={listActivityRevisionsAction}
              parent={{ organizationId }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
