import Link from "next/link";

import { SyncStateBadge } from "@/components/contacts/sync-state-badge";
import type {
  ContactListPage,
  ContactListQuery,
} from "@/features/contacts/contact-types";

function pageHref(query: ContactListQuery, page: number) {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.state !== "all") params.set("state", query.state);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/contacts?${suffix}` : "/contacts";
}

export function ContactList({
  contacts,
  query,
}: {
  contacts: ContactListPage;
  query: ContactListQuery;
}) {
  return (
    <div className="grid gap-5">
      <form
        action="/contacts"
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_14rem_auto]"
        method="get"
      >
        <label className="grid gap-1 text-sm font-semibold">
          Search contacts
          <input
            defaultValue={query.search}
            name="q"
            placeholder="Name, company, email, phone, or location"
            type="search"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Sync status
          <select defaultValue={query.state} name="state">
            <option value="all">All contacts</option>
            <option value="waiting">Waiting to sync</option>
            <option value="conflict">Needs review</option>
            <option value="synced">Synced</option>
            <option value="unlinked">Not linked</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="button-primary" type="submit">
            Search
          </button>
          <Link className="button-secondary" href="/contacts">
            Reset
          </Link>
        </div>
      </form>

      <p aria-live="polite" className="text-sm text-slate-600">
        Showing {contacts.records.length} of {contacts.total} contacts
      </p>

      {contacts.records.length ? (
        <ul className="grid gap-3">
          {contacts.records.map((contact) => {
            const fullName =
              `${contact.firstName} ${contact.lastName}`.trim();
            const location = [contact.city, contact.region]
              .filter(Boolean)
              .join(", ");
            return (
              <li
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                key={contact.id}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        className="text-lg font-bold text-slate-950 hover:text-orange-700"
                        href={`/contacts/${contact.id}`}
                      >
                        {fullName}
                      </Link>
                      <SyncStateBadge state={contact.syncState} />
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      <span>
                        {contact.organizationName || "No organization"}
                      </span>
                      {contact.jobTitle ? <span> · {contact.jobTitle}</span> : null}
                    </p>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[36rem]">
                    <div>
                      <dt className="font-semibold text-slate-500">Email</dt>
                      <dd className="break-all">
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
                      <dt className="font-semibold text-slate-500">Phone</dt>
                      <dd>
                        {contact.phone ? (
                          <a className="link" href={`tel:${contact.phone}`}>
                            {contact.phone}
                          </a>
                        ) : (
                          "Not set"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Location</dt>
                      <dd>{location || "Not set"}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="font-semibold">No contacts match these filters.</p>
          <Link className="button-secondary mt-3 inline-flex" href="/contacts">
            Reset filters
          </Link>
        </div>
      )}

      {contacts.pageCount > 1 ? (
        <nav
          aria-label="Contact pages"
          className="flex items-center justify-between gap-3"
        >
          {contacts.page > 1 ? (
            <Link
              className="button-secondary"
              href={pageHref(query, contacts.page - 1)}
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <p className="text-sm font-semibold text-slate-600">
            Page {contacts.page} of {contacts.pageCount}
          </p>
          {contacts.page < contacts.pageCount ? (
            <Link
              className="button-secondary"
              href={pageHref(query, contacts.page + 1)}
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
