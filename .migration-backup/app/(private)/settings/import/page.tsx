import { ActImportReview } from "@/components/import/act-import-review";
import { requireOwner } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requireOwner();

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          Act! CSV import fallback
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Use a contact export when the live Act! connection is unavailable.
          Review deterministic matches and apply only the rows you approve.
          This fallback never writes back to Act!.
        </p>
      </header>

      <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Conflicts are never merged automatically. Resolve duplicate local
        contacts before importing a conflicting row.
      </aside>

      <ActImportReview />
    </div>
  );
}
