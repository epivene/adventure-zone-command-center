import Link from "next/link";
import { notFound } from "next/navigation";

import { setLastResortAction } from "@/app/(private)/organizations/actions";
import { LastResortControl } from "@/components/organizations/last-resort-control";
import { LastResortWarning } from "@/components/organizations/last-resort-warning";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
}

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireOwner();
  const { organizationId } = await params;
  const { db } = await import("@/db/client");
  const organization = await new DrizzleOrganizationRepository(db).getOrganizationSummary(
    organizationId,
  );
  if (!organization) notFound();

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header>
        <Link className="text-sm font-semibold text-slate-600 hover:text-orange-700" href="/organizations">
          ← Back to organizations
        </Link>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">{organization.name}</h1>
        <p className="mt-2 text-slate-600">
          Last changed {formatDate(organization.lastResortChangedAt)}
        </p>
      </header>

      {organization.lastResort ? (
        <LastResortWarning
          organizationName={organization.name}
          reason={organization.lastResortReason}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <LastResortControl
          initialEnabled={organization.lastResort}
          initialReason={organization.lastResortReason}
          onSubmit={setLastResortAction}
          organizationId={organization.id}
        />
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Associated contacts</h2>
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
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-lg font-bold">Associated bookings</h2>
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
        </section>
      </div>
    </div>
  );
}
