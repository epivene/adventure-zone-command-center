import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPut } from "@/lib/auth-token";

type ContactSummary = {
  id: string;
  name?: string | null;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary?: boolean;
};

type InlineProfile = {
  id: string;
  place: {
    name: string;
    description?: string | null;
    phone?: string | null;
    website?: string | null;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
  };
  contacts?: ContactSummary[];
};

type ProfileDraft = {
  name: string;
  description: string;
  phone: string;
  website: string;
  address1: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
};

type ContactDraft = {
  firstName: string;
  lastName: string;
  organizationName: string;
  jobTitle: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
};

type ContactDetail = { contact: ContactDraft; phones: Array<Record<string, unknown> & { number?: string | null; primary?: boolean }> };

function profileDraft(profile: InlineProfile): ProfileDraft {
  return {
    name: profile.place.name ?? "",
    description: profile.place.description ?? "",
    phone: profile.place.phone ?? "",
    website: profile.place.website ?? "",
    address1: profile.place.address1 ?? "",
    address2: profile.place.address2 ?? "",
    city: profile.place.city ?? "",
    region: profile.place.region ?? "",
    postalCode: profile.place.postalCode ?? "",
  };
}

function fallbackContactDraft(contact: ContactSummary | null): ContactDraft {
  const parts = String(contact?.name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
    organizationName: "",
    jobTitle: contact?.role ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    address1: "",
    address2: "",
    city: "",
    region: "",
    postalCode: "",
  };
}

function updatePrimaryPhone(phones: ContactDetail["phones"], number: string) {
  if (!phones.length) return phones;
  let updated = false;
  return phones.map((phone, index) => {
    const shouldUpdate = Boolean(phone.primary) || (!updated && index === 0);
    if (!shouldUpdate || updated) return phone;
    updated = true;
    return { ...phone, number };
  });
}

export function ProfileInlineEditor({ profile, contactId, onSaved, onCancel }: {
  profile: InlineProfile;
  contactId?: string | null;
  onSaved: () => Promise<void> | void;
  onCancel?: () => void;
}) {
  const selectedContact = useMemo(() => {
    const contacts = profile.contacts ?? [];
    if (contactId) return contacts.find((contact) => contact.id === contactId) ?? contacts[0] ?? null;
    return contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
  }, [profile.contacts, contactId]);

  const [profileValues, setProfileValues] = useState<ProfileDraft>(() => profileDraft(profile));
  const [contactValues, setContactValues] = useState<ContactDraft>(() => fallbackContactDraft(selectedContact));
  const [contactPhones, setContactPhones] = useState<ContactDetail["phones"]>([]);
  const [loadingContact, setLoadingContact] = useState(Boolean(selectedContact?.id));
  const [contactLoaded, setContactLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setProfileValues(profileDraft(profile));
  }, [profile]);

  useEffect(() => {
    setContactValues(fallbackContactDraft(selectedContact));
    setContactPhones([]);
    setContactLoaded(false);
    setError("");
    if (!selectedContact?.id) {
      setLoadingContact(false);
      return;
    }
    setLoadingContact(true);
    apiGet<ContactDetail>(`/contacts/${selectedContact.id}`)
      .then((detail) => {
        setContactValues({
          firstName: detail.contact.firstName ?? "",
          lastName: detail.contact.lastName ?? "",
          organizationName: detail.contact.organizationName ?? "",
          jobTitle: detail.contact.jobTitle ?? "",
          email: detail.contact.email ?? "",
          phone: detail.contact.phone ?? "",
          address1: detail.contact.address1 ?? "",
          address2: detail.contact.address2 ?? "",
          city: detail.contact.city ?? "",
          region: detail.contact.region ?? "",
          postalCode: detail.contact.postalCode ?? "",
        });
        setContactPhones(Array.isArray(detail.phones) ? detail.phones : []);
        setContactLoaded(true);
      })
      .catch(() => setError("The contact details could not be loaded. You can still edit the profile fields."))
      .finally(() => setLoadingContact(false));
  }, [selectedContact?.id]);

  function setProfileField(name: keyof ProfileDraft, value: string) {
    setProfileValues((current) => ({ ...current, [name]: value }));
  }

  function setContactField(name: keyof ContactDraft, value: string) {
    setContactValues((current) => ({ ...current, [name]: value }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { description, ...legacyProfileValues } = profileValues;
      await apiPatch(`/event-profiles/${profile.id}`, legacyProfileValues);
      await apiPatch(`/event-profiles/${profile.id}/description`, { description });
      if (selectedContact?.id && contactLoaded) {
        await apiPut(`/contacts/${selectedContact.id}`, {
          contact: contactValues,
          phones: updatePrimaryPhone(contactPhones, contactValues.phone),
        });
      }
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const profileFields: Array<[Exclude<keyof ProfileDraft, "description">, string, string]> = [
    ["name", "Profile name", "text"],
    ["phone", "Office phone", "tel"],
    ["website", "Website", "url"],
    ["address1", "Address line 1", "text"],
    ["address2", "Address line 2", "text"],
    ["city", "City", "text"],
    ["region", "State", "text"],
    ["postalCode", "ZIP code", "text"],
  ];

  return (
    <div className="grid gap-4">
      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-bold">Profile</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
            Event description
            <textarea
              aria-label="Event description"
              onChange={(event) => setProfileField("description", event.target.value)}
              placeholder="A clean, public-safe description of the event for outreach, social posts, and proposals."
              rows={4}
              value={profileValues.description}
            />
          </label>
          {profileFields.map(([name, label, type]) => (
            <label className={`grid gap-1.5 text-sm font-medium ${name === "address1" || name === "address2" ? "sm:col-span-2" : ""}`} key={name}>
              {label}
              <input aria-label={label} type={type} value={profileValues[name]} onChange={(event) => setProfileField(name, event.target.value)} />
            </label>
          ))}
        </div>
      </section>

      {selectedContact ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold">Contact</h2>
            {loadingContact ? <span className="text-xs text-slate-500">Loading contact…</span> : !contactLoaded ? <span className="text-xs text-slate-500">Contact editing unavailable</span> : null}
          </div>
          <div className={`mt-3 grid gap-3 sm:grid-cols-2 ${contactLoaded ? "" : "opacity-60"}`} aria-disabled={!contactLoaded}>
            <label className="grid gap-1.5 text-sm font-medium">First name<input disabled={!contactLoaded} value={contactValues.firstName} onChange={(event) => setContactField("firstName", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Last name<input disabled={!contactLoaded} value={contactValues.lastName} onChange={(event) => setContactField("lastName", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Role<input disabled={!contactLoaded} value={contactValues.jobTitle} onChange={(event) => setContactField("jobTitle", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Organization<input disabled={!contactLoaded} value={contactValues.organizationName} onChange={(event) => setContactField("organizationName", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Phone<input aria-label="Phone" disabled={!contactLoaded} type="tel" value={contactValues.phone} onChange={(event) => setContactField("phone", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">Email<input disabled={!contactLoaded} type="email" value={contactValues.email} onChange={(event) => setContactField("email", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Address line 1<input disabled={!contactLoaded} value={contactValues.address1} onChange={(event) => setContactField("address1", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Address line 2<input disabled={!contactLoaded} value={contactValues.address2} onChange={(event) => setContactField("address2", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">City<input disabled={!contactLoaded} value={contactValues.city} onChange={(event) => setContactField("city", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">State<input disabled={!contactLoaded} value={contactValues.region} onChange={(event) => setContactField("region", event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium">ZIP code<input disabled={!contactLoaded} value={contactValues.postalCode} onChange={(event) => setContactField("postalCode", event.target.value)} /></label>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button className="button-primary" disabled={saving || loadingContact} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save"}</button>
        <button className="button-secondary" disabled={saving} onClick={onCancel} type="button">Cancel</button>
      </div>
    </div>
  );
}
