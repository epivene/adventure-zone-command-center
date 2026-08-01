import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { ContactList } from "@/components/contacts/contact-list";
import { contactListQuerySchema } from "@/features/contacts/contact-input";
import type { ContactListPage, ContactListQuery } from "@/features/contacts/contact-types";

export default function ContactsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const query = contactListQuerySchema.parse({
    q: params.get("q") ?? undefined,
    state: params.get("state") ?? undefined,
    page: params.get("page") ?? undefined,
  });

  const [contacts, setContacts] = useState<ContactListPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (query.search) qs.set("q", query.search);
    if (query.state !== "all") qs.set("state", query.state);
    if (query.page > 1) qs.set("page", String(query.page));

    apiGet<any>(`/contacts?${qs.toString()}`)
      .then((data) => {
        setContacts(data);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [search]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
            Relationships
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Contacts</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Find contacts, see the places and bookings they belong to.
          </p>
        </div>
        <Link className="button-primary text-center" href="/contacts/new">
          Add contact
        </Link>
      </header>

      {loading ? (
        <p className="text-slate-500">Loading contacts…</p>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-rose-700">{error}</p>
        </div>
      ) : contacts ? (
        <ContactList contacts={contacts} query={query} />
      ) : null}
    </div>
  );
}
