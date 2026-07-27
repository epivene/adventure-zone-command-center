import type { ContactSyncState } from "@/features/contacts/contact-types";

const statePresentation: Record<
  ContactSyncState,
  { label: string; className: string }
> = {
  unlinked: {
    label: "Not linked",
    className: "bg-slate-100 text-slate-700",
  },
  synced: {
    label: "Synced",
    className: "bg-emerald-100 text-emerald-800",
  },
  waiting: {
    label: "Waiting to sync",
    className: "bg-amber-100 text-amber-900",
  },
  conflict: {
    label: "Needs review",
    className: "bg-rose-100 text-rose-800",
  },
};

export function SyncStateBadge({ state }: { state: ContactSyncState }) {
  const presentation = statePresentation[state];
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${presentation.className}`}
    >
      {presentation.label}
    </span>
  );
}
