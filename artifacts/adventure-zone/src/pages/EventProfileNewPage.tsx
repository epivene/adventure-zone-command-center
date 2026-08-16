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
  const initialFamilyId = params.get("familyId") ?? "";
  const initialOrganizationId = params.get("organizationId") ?? "";

  const [travelLegs, setTravelLegs] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [families, setFamilies] = useState<any[]>([]);
  const [initialOrganizationName, setInitialOrganizationName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<any[]>("/routes/travel-legs").catch(() => []),
      apiGet<any>("/organizations?page=1&pageSize=100&showMembers=yes").catch(() => null),
      apiGet<any>("/contacts?page=1&pageSize=100").catch(() => null),
      initialOrganizationId ? apiGet<any>(`/organizations/${initialOrganizationId}`).catch(() => null) : Promise.resolve(null),
    ]).then(([legs, orgs, contactPage, parentDetail]) => {
      setTravelLegs(legs ?? []);
      setEvents(
        (orgs?.organizations?.records ?? orgs?.records ?? orgs?.organizations ?? []).map((event: any) => ({
          id: event.id,
          name: event.name,
          city: event.city ?? null,
          region: event.region ?? null,
        })),
      );
      setFamilies((orgs?.families ?? []).map((family: any) => ({ id: family.id, name: family.name })));
      setInitialOrganizationName(parentDetail?.organization?.name ?? "");
      setContacts(
        (contactPage?.records ?? contactPage?.contacts ?? []).map((contact: any) => ({
          id: contact.id,
          name: `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.name,
          organizationName: contact.organizationName ?? null,
        })),
      );
      setLoading(false);
    });
  }, [initialOrganizationId]);

  if (loading) {
    return <div className="mx-auto max-w-3xl"><p className="mt-8 text-slate-500">Loading…</p></div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Profiles & pipeline</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Add Event / Lead</h1>
        <p className="mt-2 text-slate-600">Start with the name. Contacts, location, family, booking details, and follow-up can be added now or later.</p>
      </header>
      <EventProfileForm
        events={events}
        contacts={contacts}
        families={families}
        initialFamilyId={initialFamilyId}
        initialOrganizationId={initialOrganizationId}
        initialOrganizationName={initialOrganizationName}
        travelLegs={travelLegs}
        initialContactId={initialContactId}
        initialPhone={initialPhone}
        loadEventProfile={loadEventProfileAction}
        onSubmit={async (input) => {
          const res = await createEventProfileAction(input);
          if (res.ok) navigate(`/event-profiles/${res.profileId}`);
          return res;
        }}
      />
    </div>
  );
}
