import { ActSyncReview } from "@/components/act-sync/act-sync-review";
import type { StoredSyncPreview } from "@/features/act-sync/sync-repository";
import { createDefaultActSyncService } from "@/features/act-sync/sync-service";
import { requireOwner } from "@/lib/auth/require-owner";
import { getActEnvironment } from "@/lib/env";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function maskDatabase(databaseName: string) {
  const visible = databaseName.slice(-4);
  return `${"•".repeat(Math.max(4, databaseName.length - visible.length))}${visible}`;
}

export default async function ActSyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOwner();
  let configured = false;
  let maskedDatabase: string | null = null;
  try {
    const environment = getActEnvironment();
    configured = environment.configured;
    maskedDatabase = environment.configured
      ? maskDatabase(environment.config.databaseName)
      : null;
  } catch {
    configured = false;
  }

  const runId = firstValue((await searchParams).runId);
  let preview: StoredSyncPreview | null = null;
  if (configured) {
    try {
      const service = await createDefaultActSyncService();
      preview = runId
        ? await service.getPreview(runId)
        : await service.getLatestPreview();
    } catch {
      preview = null;
    }
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-6">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Act! sync</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Compare the Command Center with Act!, review every proposed change,
          and apply only the decisions you approve.
        </p>
      </header>

      <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
        Act! is a shared account. Sync never runs automatically, and conflicts
        are never resolved automatically.
      </aside>

      <ActSyncReview
        configured={configured}
        initialPreview={preview}
        maskedDatabase={maskedDatabase}
      />
    </div>
  );
}
