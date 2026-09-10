import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet, bossPut } from "@/lib/boss-auth-context";
import { ContactForm } from "@/components/contacts/contact-form";
import type { ContactPhoneInput } from "@/features/contact-phones/contact-phone-types";
import type { BossContact } from "@/lib/boss-types";

type ContactPlace = { id: string; name: string; role: string | null; isPrimaryPlace: boolean; active: boolean };
type ContactDetail = { contact: BossContact; places: ContactPlace[]; phones: ContactPhoneInput[]; relatedBookings: unknown[] };

export default function BossContactDetailPage({ contactId }: { contactId: string }) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<ContactDetail>(`/boss/contacts/${contactId}`);
      setDetail(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load contact.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [contactId]);

  if (loading) {
    return (
      <div className="grid gap-4 max-w-xl">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center" role="alert">
        <p className="font-semibold text-destructive">{error ?? "Contact not found."}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={() => void load()} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
          <Link href="/boss/contacts" className="text-sm font-semibold text-primary hover:underline">
            Back to Contacts
          </Link>
        </div>
      </div>
    );
  }

  const { contact, places, phones } = detail;
  const connectedProfiles = places.filter((place) => place.active);
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";
  const fields = [
    ["Email", contact.email],
    ["Phone", contact.phone],
    ["Job title", contact.jobTitle],
    ["Location", [contact.city, contact.region].filter(Boolean).join(", ")],
    ["Mailing address", [contact.address1, contact.address2, contact.city, contact.region, contact.postalCode].filter(Boolean).join(", ")],
  ].filter(([, value]) => value);

  return (
    <div className="grid gap-5 max-w-xl" data-testid="boss-contact-detail">
      <div className="flex items-center gap-2">
        <Link href="/boss/contacts" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Contacts
        </Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-foreground">{name}</h1>{contact.organizationName ? <p className="mt-1 text-sm text-muted-foreground">{contact.organizationName}</p> : null}</div>
        <Button onClick={() => setEditing((value) => !value)} variant="outline">{editing ? "Close Edit" : "Edit Contact"}</Button>
      </header>

      {editing ? <section className="rounded-xl border border-primary/20 bg-card p-4 shadow-sm"><ContactForm
        initialPhones={phones}
        phonesEditable
        initialValues={{
          firstName: contact.firstName ?? "",
          lastName: contact.lastName ?? "",
          organizationName: contact.organizationName ?? "",
          jobTitle: contact.jobTitle ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          address1: contact.address1 ?? "",
          address2: contact.address2 ?? "",
          city: contact.city ?? "",
          region: contact.region ?? "",
          postalCode: contact.postalCode ?? "",
        }}
        onSubmit={async (input, submittedPhones) => {
          await bossPut(`/boss/contacts/${contactId}`, { contact: input, phones: submittedPhones ?? [] });
          return { ok: true };
        }}
        successPath={`/boss/contacts/${contactId}`}
        variant="edit"
      /></section> : null}

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-lg font-bold">Connected Profiles ({connectedProfiles.length})</h2>
        {connectedProfiles.length ? <div className="mt-3 grid gap-2">{connectedProfiles.map((place) => <Link className="rounded-lg border border-border p-3 transition hover:border-primary/50 hover:bg-primary/5" href={`/boss/profiles/${place.id}`} key={place.id}><span className="font-bold text-primary">{place.name}</span>{place.isPrimaryPlace ? <span className="ml-2 text-xs font-semibold text-muted-foreground">Primary</span> : null}{place.role ? <span className="mt-1 block text-sm text-muted-foreground">{place.role}</span> : null}</Link>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No profiles are connected to this contact.</p>}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-bold">Contact Details</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
              </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
