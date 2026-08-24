import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { apiGet, apiPost } from "@/lib/auth-token";
import { EventProfileForm } from "@/components/event-profiles/event-profile-form";
import { createEventProfileAction } from "@/actions/event-profiles";

export default function EventProfileNewPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialContactId = params.get("contactId") ?? "";
  const initialPhone = params.get("phone") ?? "";
  const initialFamilyId = params.get("familyId") ?? "";
  const initialOrganizationId = params.get("organizationId") ?? "";
  const initialEventName = params.get("name") ?? "";
  const initialCity = params.get("city") ?? "";
  const initialRegion = params.get("region") ?? "";
  const initialSourceUrl = params.get("sourceUrl") ?? "";
  const initialStartsAt = params.get("startsAt") ?? "";
  const initialEndsAt = params.get("endsAt") ?? "";
  const sourceScoutIntake = params.get("source") === "scout";

  const [travelLegs, setTravelLegs] = useState<any[]>([]);
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
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Profiles</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Add a New Profile</h1>
        <p className="mt-2 text-slate-600">Build the profile with everything you already know. Nothing is created until you press Save Profile, and unfinished work is protected on this device.</p>
      </header>
      <EventProfileForm
        contacts={contacts}
        families={families}
        initialFamilyId={initialFamilyId}
        initialOrganizationId={initialOrganizationId}
        initialOrganizationName={initialOrganizationName}
        travelLegs={travelLegs}
        initialContactId={initialContactId}
        initialPhone={initialPhone}
        initialEventName={initialEventName}
        initialCity={initialCity}
        initialRegion={initialRegion}
        initialWebsite={initialSourceUrl}
        initialStartsAt={initialStartsAt}
        initialEndsAt={initialEndsAt}
        sourceScoutIntake={sourceScoutIntake}
        onSubmit={async (input) => {
          const res = await createEventProfileAction(input);
          if (res.ok && sourceScoutIntake && initialSourceUrl) {
            await apiPost(`/event-profiles/${res.profileId}/research-intake-context`, {
              sourceUrl: initialSourceUrl,
              startsAt: initialStartsAt,
              endsAt: initialEndsAt,
            }).catch(() => null);
          }
          return res;
        }}
      />
    </div>
  );
}
