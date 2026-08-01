import Link from "next/link";

import { createContactAction } from "@/app/(private)/contacts/actions";
import { ContactForm } from "@/components/contacts/contact-form";
import { requireOwner } from "@/lib/auth/require-owner";

export default async function NewContactPage() {
  await requireOwner();
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <Link
          className="text-sm font-semibold text-slate-600 hover:text-orange-700"
          href="/contacts"
        >
          ← Back to contacts
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Contacts
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Add contact</h1>
        <p className="mt-2 text-slate-600">
          This saves in Command Center and waits for your next approved Act!
          sync.
        </p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <ContactForm
          onSubmit={createContactAction}
          successPath="/contacts"
        />
      </section>
    </div>
  );
}
