import { useLocation, useSearch } from "wouter";

import { CallerFinder } from "@/components/calls/caller-finder";
import { QuickAddCaller, type QuickAddCallerSubmission } from "@/components/contacts/quick-add-caller";
import { apiPost } from "@/lib/auth-token";

type QuickAddResult =
  | { ok: true; contactId: string }
  | { ok: false; error: string }
  | { ok: false; candidates: Array<{
      contactId: string;
      name: string;
      organizationName: string | null;
      city: string | null;
      region: string | null;
      reasons: string[];
      kind: "exact" | "likely";
    }> };

export default function QuickAddPage() {
  const params = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const creating = params.get("create") === "1";

  return (
    <main className="mx-auto grid max-w-3xl gap-6 py-8">
      <div>
        <h1 className="text-3xl font-bold">Quick add caller</h1>
        <p className="mt-2 text-slate-600">Create a caller only after reviewing possible duplicates.</p>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {creating ? (
          <QuickAddCaller
            initialPhone={params.get("phone") ?? ""}
            initialQuery={params.get("q") ?? ""}
            onSubmit={(input: QuickAddCallerSubmission) => apiPost<QuickAddResult>("/calls/quick-caller", input)}
          />
        ) : (
          <CallerFinder
            initialPhone={params.get("phone") ?? ""}
            onSelect={(contactId) => navigate(`/calls/new?contactId=${contactId}`)}
          />
        )}
      </section>
    </main>
  );
}
