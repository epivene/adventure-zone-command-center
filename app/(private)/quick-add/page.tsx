import Link from "next/link";

import { createQuickCallerAction } from "@/app/(private)/quick-add/actions";
import { QuickAddCaller } from "@/components/contacts/quick-add-caller";
import { findContactsByPhone } from "@/features/contacts/contact-repository";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function QuickAddPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  const phone = firstValue((await searchParams).phone)?.trim() ?? "";
  const match = await findContactsByPhone(phone);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <Link className="text-sm font-semibold text-slate-600 hover:text-orange-700" href="/today">← Back to Today</Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Quick Add</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Add a caller</h1>
        <p className="mt-2 text-slate-600">Match an existing caller or capture a new caller locally before beginning the call note.</p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <QuickAddCaller initialPhone={phone} match={match} onSubmit={createQuickCallerAction} />
      </section>
    </div>
  );
}
