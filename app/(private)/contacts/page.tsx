import Link from "next/link";

import { ContactList } from "@/components/contacts/contact-list";
import { contactListQuerySchema } from "@/features/contacts/contact-input";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const raw = await searchParams;
  const query = contactListQuerySchema.parse({
    q: firstValue(raw.q),
    state: firstValue(raw.state),
    page: firstValue(raw.page),
  });
  const { db } = await import("@/db/client");
  const contacts = await new DrizzleContactRepository(db).listContacts(query);

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
            Relationships
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Contacts</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Find contacts, see the places and bookings they belong to, and keep local
            edits ready for your next approved Act! sync.
          </p>
        </div>
        <Link className="button-primary text-center" href="/contacts/new">
          Add contact
        </Link>
      </header>

      <ContactList contacts={contacts} query={query} />
    </div>
  );
}
