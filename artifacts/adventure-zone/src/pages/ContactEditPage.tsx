import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { apiGet, apiPut } from "@/lib/auth-token";
import { ContactForm } from "@/components/contacts/contact-form";

export default function ContactEditPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const [, navigate] = useLocation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId) return;
    apiGet<any>(`/contacts/${contactId}`)
      .then((d) => {
        const primaryProfile = (d.places ?? []).find((place: any) => place.isPrimaryPlace) ?? d.places?.[0] ?? null;
        if (primaryProfile?.id) {
          navigate(`/profiles/${primaryProfile.id}?contactId=${contactId}`, { replace: true });
          return;
        }
        setData(d);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [contactId, navigate]);

  if (loading) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-slate-500">Opening profile…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Edit unlinked contact</h1>
      <p className="mb-5 text-sm text-slate-600">This fallback editor is only used for contacts that are not attached to a profile yet.</p>
      <ContactForm
        initialPhones={data.phones ?? []}
        phonesEditable
        initialValues={{
          firstName: data.contact.firstName,
          lastName: data.contact.lastName,
          organizationName: data.contact.organizationName ?? "",
          jobTitle: data.contact.jobTitle ?? "",
          email: data.contact.email ?? "",
          phone: data.contact.phone ?? "",
          address1: data.contact.address1 ?? "",
          address2: data.contact.address2 ?? "",
          city: data.contact.city ?? "",
          region: data.contact.region ?? "",
          postalCode: data.contact.postalCode ?? "",
        }}
        onSubmit={async (contact, phones) => {
          try {
            return await apiPut(`/contacts/${contactId}`, { contact, phones: phones ?? [] });
          } catch (error: any) {
            return { ok: false, error: error.message ?? "Could not update contact." };
          }
        }}
        successPath={`/contacts/${contactId}`}
        variant="edit"
      />
    </div>
  );
}
