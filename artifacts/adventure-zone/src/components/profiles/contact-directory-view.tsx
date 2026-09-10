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
    page: params.get("page") ?? undefined,
  });
  const [contacts, setContacts] = useState<ContactListPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const qs = new URLSearchParams();
    if (query.search) qs.set("q", query.search);
    if (query.page > 1) qs.set("page", String(query.page));
    setLoading(true);
    setError(null);
    apiGet<ContactListPage>(`/contacts?${qs.toString()}`)
      .then((data) => { if (active) setContacts(data); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Failed to load contacts"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query.search, query.page]);

  if (!contacts) return loading ? <p className="text-slate-500">Loading contacts…</p> : error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : null;
  return <>{error ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : null}<ContactList contacts={contacts} loading={loading} query={query} basePath={basePath} fixedParams={fixedParams} /></>;
}
