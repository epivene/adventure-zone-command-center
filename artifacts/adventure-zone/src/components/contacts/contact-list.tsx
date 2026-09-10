import { useEffect, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import { Link, useLocation } from "wouter";

import type {
  ContactListPage,
  ContactListQuery,
} from "@/features/contacts/contact-types";

type FixedParams = Record<string, string>;

function contactListHref(
  basePath: string,
  fixedParams: FixedParams,
  query: ContactListQuery,
  page = query.page,
) {
  const params = new URLSearchParams(fixedParams);
  if (query.search) params.set("q", query.search);
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

function resetHref(basePath: string, fixedParams: FixedParams) {
  const params = new URLSearchParams(fixedParams);
  const suffix = params.toString();
  return suffix ? `${basePath}?${suffix}` : basePath;
}

export function ContactList({
  contacts,
  query,
  basePath = "/contacts",
  fixedParams = {},
  loading = false,
}: {
  contacts: ContactListPage;
  query: ContactListQuery;
  basePath?: string;
  fixedParams?: FixedParams;
  loading?: boolean;
}) {
  const [, setLocation] = useLocation();
  const [searchValue, setSearchValue] = useState(query.search);
  const [pendingSearch, setPendingSearch] = useState(false);
  const reset = resetHref(basePath, fixedParams);
  useEffect(() => { setSearchValue(query.search); }, [query.search]);
  useEffect(() => {
    if (searchValue === query.search) return;
    const id = window.setTimeout(() => setLocation(contactListHref(basePath, fixedParams, { ...query, search: searchValue.trim(), page: 1 }, 1)), 150);
    return () => window.clearTimeout(id);
  }, [basePath, fixedParams, query, query.search, searchValue, setLocation]);
  useEffect(() => {
    if (!loading && searchValue === query.search) setPendingSearch(false);
  }, [loading, query.search, searchValue]);
  const searching = pendingSearch || loading;
  return (
    <div className="grid gap-5">
      <form
        action={basePath}
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_auto]"
        method="get"
      >
        {Object.entries(fixedParams).map(([name, value]) => (
          <input key={name} name={name} type="hidden" value={value} />
        ))}
        <label className="grid gap-1 text-sm font-semibold">
          <span>Search contacts</span>
          <span className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            aria-label="Search contacts"
            className="w-full pr-10"
            name="q"
            onChange={(event) => { setSearchValue(event.currentTarget.value); setPendingSearch(true); }}
            placeholder="Name, company, email, phone, or location"
            style={{ paddingLeft: "3rem" }}
            type="search"
            value={searchValue}
          />
          {searching ? <span aria-label="Searching contacts" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-orange-700" role="status"><LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /></span> : null}
          </span>
        </label>
        <div className="flex items-end gap-2">
          <Link className="button-secondary" href={reset}>
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
            const fullName = `${contact.firstName} ${contact.lastName}`.trim();
            const location = [contact.city, contact.region].filter(Boolean).join(", ");
            return (
              <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={contact.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <Link className="text-lg font-bold text-slate-950 hover:text-orange-700" href={`/contacts/${contact.id}`}>
                      {fullName}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">
                      <span>{contact.organizationName || "No organization"}</span>
                      {contact.jobTitle ? <span> · {contact.jobTitle}</span> : null}
                    </p>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[36rem]">
                    <div>
                      <dt className="font-semibold text-slate-500">Email</dt>
                      <dd className="break-all">
                        {contact.email ? <a className="link" href={`mailto:${contact.email}`}>{contact.email}</a> : "Not set"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Phone</dt>
                      <dd>{contact.phone ? <a className="link" href={`tel:${contact.phone}`}>{contact.phone}</a> : "Not set"}</dd>
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
          <Link className="button-secondary mt-3 inline-flex" href={reset}>Reset filters</Link>
        </div>
      )}

      {contacts.pageCount > 1 ? (
        <nav aria-label="Contact pages" className="flex items-center justify-between gap-3">
          {contacts.page > 1 ? (
            <Link className="button-secondary" href={contactListHref(basePath, fixedParams, query, contacts.page - 1)}>Previous</Link>
          ) : <span />}
          <p className="text-sm font-semibold text-slate-600">Page {contacts.page} of {contacts.pageCount}</p>
          {contacts.page < contacts.pageCount ? (
            <Link className="button-secondary" href={contactListHref(basePath, fixedParams, query, contacts.page + 1)}>Next</Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  );
}
