import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { apiGet, apiPut } from "@/lib/auth-token";
import { ContactForm } from "@/components/contacts/contact-form";

export default function ContactEditPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contactId) return;
    apiGet<any>(`/contacts/${contactId}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [contactId]);

  if (loading) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-slate-500">Loading…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-2xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">Edit contact</h1>
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
