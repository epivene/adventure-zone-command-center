import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { EventProfileForm } from "@/components/event-profiles/event-profile-form";
import {
  loadEventProfileAction,
  createEventProfileAction,
} from "@/actions/event-profiles";

export default function EventProfileNewPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialContactId = params.get("contactId") ?? "";
  const initialPhone = params.get("phone") ?? "";

  const [travelLegs, setTravelLegs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<any[]>("/routes/travel-legs").catch(() => []),
      apiGet<any>("/organizations?page=1&pageSize=100").catch(() => null),
      apiGet<any>("/contacts?page=1&pageSize=100").catch(() => null),
    ]).then(([legs, orgs, contactPage]) => {
      setTravelLegs(legs ?? []);
      setEvents(
        (orgs?.records ?? orgs?.organizations ?? []).map((event: any) => ({
          id: event.id,
          name: event.name,
          city: null,
          region: null,
        })),
      );
      setContacts(
        (contactPage?.records ?? contactPage?.contacts ?? []).map((contact: any) => ({
          id: contact.id,
          name: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.name,
          organizationName: contact.organizationName ?? null,
        })),
      );
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-3xl"><p className="mt-8 text-slate-500">Loading…</p></div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">New event profile</h1>
      <EventProfileForm
        events={events}
        contacts={contacts}
        travelLegs={travelLegs}
        initialContactId={initialContactId}
        initialPhone={initialPhone}
        loadEventProfile={loadEventProfileAction}
        onSubmit={async (input: any) => {
          const res = await createEventProfileAction(input);
          if (res.ok) navigate(`/event-profiles/${res.profileId}`);
          return res;
        }}
      />
    </div>
  );
}
