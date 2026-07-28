import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SyncStateBadge } from "@/components/contacts/sync-state-badge";
import { LastResortWarning } from "@/components/organizations/last-resort-warning";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function formatDate(value: Date | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  await requireOwner();
  const { contactId } = await params;
  const { db } = await import("@/db/client");
  const repository = new DrizzleContactRepository(db);
  const detail = await repository.getContactDetail(contactId);
  if (!detail) notFound();
  const audits = await repository.listRecentAuditEntries(contactId);
  const { contact, relatedBookings } = detail;
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  const address = [
    contact.address1,
    contact.address2,
    contact.city,
    contact.region,
    contact.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header>
        <Link
          className="text-sm font-semibold text-slate-600 hover:text-orange-700"
          href="/contacts"
        >
          ← Back to contacts
        </Link>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{fullName}</h1>
              <SyncStateBadge state={contact.syncState} />
            </div>
            <p className="mt-2 text-slate-600">
              {contact.organizationName || "No organization"}
              {contact.jobTitle ? ` · ${contact.jobTitle}` : ""}
            </p>
          </div>
          <Link
            className="button-secondary text-center"
            href={`/contacts/${contact.id}/edit`}
          >
            Edit contact
          </Link>
        </div>
      </header>

      {contact.syncState === "waiting" ? (
        <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
          This contact has local changes waiting for your next approved Act!
          sync.
        </aside>
      ) : null}

      {contact.organizationName && contact.organizationLastResort ? (
        <LastResortWarning
          organizationName={contact.organizationName}
          reason={contact.organizationLastResortReason ?? null}
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <DetailSection title="Contact information">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-slate-500">Email</dt>
              <dd className="mt-1 break-all">
                {contact.email ? (
                  <a className="link" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                ) : (
                  "Not set"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">Phone</dt>
              <dd className="mt-1">
                {contact.phone ? (
                  <a className="link" href={`tel:${contact.phone}`}>
                    {contact.phone}
                  </a>
                ) : (
                  "Not set"
                )}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-semibold text-slate-500">Address</dt>
              <dd className="mt-1">{address || "Not set"}</dd>
            </div>
          </dl>
        </DetailSection>

        <DetailSection title="Act! synchronization">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-slate-500">Status</dt>
              <dd className="mt-1">
                <SyncStateBadge state={contact.syncState} />
              </dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">
                Last synced
              </dt>
              <dd className="mt-1">{formatDate(contact.lastSyncedAt)}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">
                Act! record
              </dt>
              <dd className="mt-1">{contact.actRecordId || "Not linked yet"}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-slate-500">
                Last local edit
              </dt>
              <dd className="mt-1">{formatDate(contact.updatedAt)}</dd>
            </div>
          </dl>
        </DetailSection>

        <DetailSection title="Related bookings">
          {relatedBookings.length ? (
            <ul className="divide-y divide-slate-200">
              {relatedBookings.map((booking) => (
                <li className="py-3" key={booking.id}>
                  <Link
                    className="font-bold hover:text-orange-700"
                    href={`/bookings/${booking.id}`}
                  >
                    {booking.name}
                  </Link>
                  <p className="mt-1 text-sm text-slate-600">
                    {booking.city}, {booking.region} ·{" "}
                    {booking.status.replaceAll("_", " ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">
              No bookings are linked to this contact yet.
            </p>
          )}
        </DetailSection>

        <DetailSection title="Contact history">
          {audits.length ? (
            <ol className="grid gap-3">
              {audits.map((entry) => (
                <li
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
                  key={entry.id}
                >
                  <span className="font-semibold">
                    {entry.action.replaceAll("_", " ")}
                  </span>
                  <time className="ml-2 text-slate-500">
                    {formatDate(entry.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-600">No contact changes recorded.</p>
          )}
        </DetailSection>
      </div>
    </div>
  );
}
