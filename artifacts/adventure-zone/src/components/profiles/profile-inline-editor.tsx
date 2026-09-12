import { useEffect, useMemo, useState } from "react";

import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/auth-token";

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
    applicationDeadline?: string | null;
    recommendedDealModel?: "flat_fee" | "pay_per_play" | "either" | null;
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
  applicationDeadline: string;
  recommendedDealModel: "" | "flat_fee" | "pay_per_play" | "either";
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
type CreateContactResult = { ok?: boolean; contactId?: string; error?: string };

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
    applicationDeadline: profile.place.applicationDeadline ?? "",
    recommendedDealModel: profile.place.recommendedDealModel ?? "",
  };
}

function fallbackContactDraft(contact: ContactSummary | null, organizationName = ""): ContactDraft {
  const parts = String(contact?.name ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
    organizationName,
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
  if (!phones.length) {
    const trimmed = number.trim();
    return trimmed
      ? [{ id: null, number: trimmed, type: "unknown", extension: null, label: null, primary: true }]
      : [];
  }
  let updated = false;
  return phones.map((phone, index) => {
    const shouldUpdate = Boolean(phone.primary) || (!updated && index === 0);
    if (!shouldUpdate || updated) return phone;
    updated = true;
    return { ...phone, number };
  });
}

function initialContactId(profile: InlineProfile, requestedId?: string | null) {
  const contacts = profile.contacts ?? [];
  if (requestedId && contacts.some((contact) => contact.id === requestedId)) return requestedId;
  return contacts.find((contact) => contact.isPrimary)?.id ?? contacts[0]?.id ?? null;
}

export function ProfileInlineEditor({ profile, contactId, onSaved, onCancel }: {
  profile: InlineProfile;
  contactId?: string | null;
  onSaved: () => Promise<void> | void;
  onCancel?: () => void;
}) {
  const contacts = profile.contacts ?? [];
  const [activeContactId, setActiveContactId] = useState<string | null>(() => initialContactId(profile, contactId));
  // A profile with no contacts is still a valid profile. Creating a contact is
  // an explicit user action via Add contact, never an automatic side effect of Save.
  const [creatingContact, setCreatingContact] = useState(false);
  const selectedContact = useMemo(
    () => creatingContact ? null : contacts.find((contact) => contact.id === activeContactId) ?? contacts[0] ?? null,
    [contacts, activeContactId, creatingContact],
  );

  const [profileValues, setProfileValues] = useState<ProfileDraft>(() => profileDraft(profile));
  const [contactValues, setContactValues] = useState<ContactDraft>(() => fallbackContactDraft(selectedContact, profile.place.name));
  const [contactPhones, setContactPhones] = useState<ContactDetail["phones"]>([]);
  const [loadingContact, setLoadingContact] = useState(Boolean(selectedContact?.id));
  const [contactLoaded, setContactLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setProfileValues(profileDraft(profile));
  }, [profile]);

  useEffect(() => {
    if (creatingContact) return;
    setActiveContactId(initialContactId(profile, contactId));
  }, [contactId, profile.id]);

  useEffect(() => {
    if (creatingContact) {
      setContactValues(fallbackContactDraft(null, profileValues.name || profile.place.name));
      setContactPhones([]);
      setContactLoaded(true);
      setLoadingContact(false);
      setError("");
      return;
    }

    setContactValues(fallbackContactDraft(selectedContact, profileValues.name || profile.place.name));
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
          organizationName: profileValues.name || profile.place.name,
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
  }, [selectedContact?.id, creatingContact]);

  function setProfileField<Name extends keyof ProfileDraft>(name: Name, value: ProfileDraft[Name]) {
    setProfileValues((current) => ({ ...current, [name]: value }));
  }

  function setContactField(name: keyof ContactDraft, value: string) {
    setContactValues((current) => ({ ...current, [name]: value }));
  }

  function chooseContact(nextId: string) {
    setCreatingContact(false);
    setActiveContactId(nextId);
  }

  function startNewContact() {
    setCreatingContact(true);
    setContactValues(fallbackContactDraft(null, profileValues.name || profile.place.name));
    setContactPhones([]);
    setContactLoaded(true);
    setLoadingContact(false);
    setError("");
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { description, applicationDeadline, recommendedDealModel, ...legacyProfileValues } = profileValues;
      await apiPatch(`/event-profiles/${profile.id}`, {
        ...legacyProfileValues,
        applicationDeadline: applicationDeadline || null,
        recommendedDealModel: recommendedDealModel || null,
      });
      await apiPatch(`/event-profiles/${profile.id}/description`, { description });

      const linkedContact = {
        ...contactValues,
        organizationName: profileValues.name,
      };

      if (creatingContact) {
        const created = await apiPost<CreateContactResult>("/contacts", linkedContact);
        if (!created?.contactId) throw new Error(created?.error ?? "The contact could not be created.");
        const phone = linkedContact.phone.trim();
        if (phone) {
          await apiPut(`/contacts/${created.contactId}/phones`, {
            phones: [{ id: null, number: phone, type: "unknown", extension: null, label: null, primary: true }],
          });
        }
      } else if (selectedContact?.id && contactLoaded) {
        await apiPut(`/contacts/${selectedContact.id}`, {
          contact: linkedContact,
          phones: updatePrimaryPhone(contactPhones, linkedContact.phone),
        });
      }
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The profile could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const profileFields: Array<[Exclude<keyof ProfileDraft, "description" | "applicationDeadline" | "recommendedDealModel">, string, string]> = [
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
          <label className="grid gap-1.5 text-sm font-medium">
            Application / outreach deadline
            <input aria-label="Application / outreach deadline" type="date" value={profileValues.applicationDeadline} onChange={(event) => setProfileField("applicationDeadline", event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Recommended deal model
            <select aria-label="Recommended deal model" value={profileValues.recommendedDealModel} onChange={(event) => setProfileField("recommendedDealModel", event.target.value as ProfileDraft["recommendedDealModel"])}>
              <option value="">No recommendation recorded</option>
              <option value="flat_fee">Flat fee</option>
              <option value="pay_per_play">Pay-per-play</option>
              <option value="either">Either</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-bold">Contacts</h2>
            <p className="mt-1 text-sm text-slate-500">Create and edit the people for this profile here.</p>
          </div>
          <button className="button-secondary" type="button" onClick={startNewContact}>Add contact</button>
        </div>

        {contacts.length ? (
          <label className="mt-4 grid max-w-md gap-1.5 text-sm font-medium">
            Contact to edit
            <select aria-label="Contact to edit" disabled={creatingContact} value={creatingContact ? "" : selectedContact?.id ?? ""} onChange={(event) => chooseContact(event.target.value)}>
              {creatingContact ? <option value="">New contact</option> : null}
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name || "Unnamed contact"}{contact.isPrimary ? " · Primary" : ""}</option>)}
            </select>
          </label>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="font-semibold text-slate-800">{creatingContact ? "New contact" : selectedContact?.name || "Contact"}</p>
          {loadingContact ? <span className="text-xs text-slate-500">Loading contact…</span> : !contactLoaded ? <span className="text-xs text-slate-500">Contact editing unavailable</span> : null}
        </div>
        <div className={`mt-3 grid gap-3 sm:grid-cols-2 ${contactLoaded ? "" : "opacity-60"}`} aria-disabled={!contactLoaded}>
          <label className="grid gap-1.5 text-sm font-medium">First name<input aria-label="First name" disabled={!contactLoaded} value={contactValues.firstName} onChange={(event) => setContactField("firstName", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Last name<input aria-label="Last name" disabled={!contactLoaded} value={contactValues.lastName} onChange={(event) => setContactField("lastName", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Role<input aria-label="Role" disabled={!contactLoaded} value={contactValues.jobTitle} onChange={(event) => setContactField("jobTitle", event.target.value)} /></label>
          <div className="grid gap-1.5 text-sm font-medium"><span>Profile</span><div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-normal text-slate-700">{profileValues.name}</div></div>
          <label className="grid gap-1.5 text-sm font-medium">Phone<input aria-label="Phone" disabled={!contactLoaded} type="tel" value={contactValues.phone} onChange={(event) => setContactField("phone", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium">Email<input aria-label="Email" disabled={!contactLoaded} type="email" value={contactValues.email} onChange={(event) => setContactField("email", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Address line 1<input aria-label="Contact address line 1" disabled={!contactLoaded} value={contactValues.address1} onChange={(event) => setContactField("address1", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Address line 2<input aria-label="Contact address line 2" disabled={!contactLoaded} value={contactValues.address2} onChange={(event) => setContactField("address2", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium">City<input aria-label="Contact city" disabled={!contactLoaded} value={contactValues.city} onChange={(event) => setContactField("city", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium">State<input aria-label="Contact state" disabled={!contactLoaded} value={contactValues.region} onChange={(event) => setContactField("region", event.target.value)} /></label>
          <label className="grid gap-1.5 text-sm font-medium">ZIP code<input aria-label="Contact ZIP code" disabled={!contactLoaded} value={contactValues.postalCode} onChange={(event) => setContactField("postalCode", event.target.value)} /></label>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button className="button-primary" disabled={saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save"}</button>
        <button className="button-secondary" disabled={saving} onClick={onCancel} type="button">Cancel</button>
      </div>
    </div>
  );
}
