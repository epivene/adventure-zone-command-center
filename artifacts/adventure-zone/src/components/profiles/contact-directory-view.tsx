import { useCallback, useEffect, useRef, useState } from "react";

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
  const mounted = useRef(true);
  const desiredPath = useRef("");
  const requestState = useRef({
    inFlight: false,
    queuedPath: null as string | null,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestState.current.queuedPath = null;
    };
  }, []);

  const loadLatest = useCallback(async (nextPath: string) => {
    const state = requestState.current;
    state.queuedPath = nextPath;
    if (state.inFlight) return;

    state.inFlight = true;
    while (state.queuedPath !== null && mounted.current) {
      const requestedPath = state.queuedPath;
      state.queuedPath = null;
      try {
        const data = await apiGet<ContactListPage>(requestedPath);
        if (mounted.current && desiredPath.current === requestedPath) {
          setContacts(data);
        }
      } catch (cause) {
        if (mounted.current && desiredPath.current === requestedPath) {
          setError(
            cause instanceof Error ? cause.message : "Failed to load contacts",
          );
        }
      }
    }

    state.inFlight = false;
    if (mounted.current) setLoading(false);
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (query.search) qs.set("q", query.search);
    if (query.page > 1) qs.set("page", String(query.page));
    const path = `/contacts?${qs.toString()}`;
    desiredPath.current = path;
    setLoading(true);
    setError(null);
    void loadLatest(path);
  }, [loadLatest, query.search, query.page]);

  if (!contacts) {
    return loading
      ? <p className="text-slate-500">Loading contacts…</p>
      : error
        ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div>
        : null;
  }
  return <>{error ? <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-rose-700">{error}</p></div> : null}<ContactList contacts={contacts} loading={loading} query={query} basePath={basePath} fixedParams={fixedParams} /></>;
}
