import Link from "next/link";
import { notFound } from "next/navigation";

import { updateContactAction } from "@/app/(private)/contacts/actions";
import { ContactForm } from "@/components/contacts/contact-form";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  await requireOwner();
  const { contactId } = await params;
  const { db } = await import("@/db/client");
  const detail = await new DrizzleContactRepository(db).getContactDetail(
    contactId,
  );
  if (!detail) notFound();
  const { contact } = detail;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <Link
          className="text-sm font-semibold text-slate-600 hover:text-orange-700"
          href={`/contacts/${contactId}`}
        >
          ← Back to contact
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Contacts
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Edit contact</h1>
        <p className="mt-2 text-slate-600">
          Saving marks this contact as waiting until you approve an Act! sync.
        </p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <ContactForm
          initialValues={{
            firstName: contact.firstName,
            lastName: contact.lastName,
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
          onSubmit={updateContactAction.bind(null, contactId)}
          successPath={`/contacts/${contactId}`}
          variant="edit"
        />
      </section>
    </div>
  );
}
