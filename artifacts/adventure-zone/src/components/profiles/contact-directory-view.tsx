import { useEffect, useState } from "react";

import { ContactList } from "@/components/contacts/contact-list";
import { apiGet } from "@/lib/auth-token";
import { contactListQuerySchema } from "@/features/contacts/contact-input";
import type { ContactListPage } from "@/features/contacts/contact-types";

export function ContactDirectoryView({
  search,
  basePath = "/profiles",
  fixedParams = { view: "contacts" },
}: {
  search: string;
  basePath?: string;
  fixedParams?: Record<string, string>;
}) {
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
    setLoading(true);
    setError(null);
    apiGet<ContactListPage>(`/contacts?${qs.toString()}`)
      .then((data) => setContacts(data))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load contacts"))
      .finally(() => setLoading(false));
  }, [query.search, query.state, query.page]);

  if (loading) return <p className="text-slate-500">Loading contacts…</p>;
  if (error) return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div>;
  return contacts ? <ContactList contacts={contacts} query={query} basePath={basePath} fixedParams={fixedParams} /> : null;
}
