import { Link } from "wouter";

import type { ContractVersion } from "@/features/contracts/contract-types";
import { CoiNextAction } from "./coi-next-action";

const statusLabels: Record<ContractVersion["status"], string> = {
  draft: "Draft",
  ready_for_adobe: "Ready for Adobe",
  sent_for_signature: "Sent for signature",
  partially_signed: "Partially signed",
  completed: "Completed",
  declined: "Declined",
  cancelled: "Cancelled",
  superseded: "Superseded",
};

export function ContractHistoryCard({ version }: { version: ContractVersion }) {
  return (
    <article className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">Version {version.versionNumber ?? 1}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{statusLabels[version.status]}</span>
      </div>
      <p className="text-sm font-semibold">{version.snapshot.values.eventName}</p>
      {version.predecessorVersionId ? <p className="text-xs text-slate-600">Replaces version {version.predecessorVersionId}</p> : null}
      {version.supersedingVersionId ? <Link className="text-sm font-semibold text-sky-700" href={`/contracts/${version.supersedingVersionId}/handoff`}>Open replacement version</Link> : null}
      {version.files?.length ? <ul className="grid gap-1 text-sm">
        {version.files.map((file) => <li key={file.id}><span>{file.originalFilename}</span> · revision {file.revision}</li>)}
      </ul> : <p className="text-sm text-slate-500">No PDF stored yet.</p>}
      <Link className="button-secondary min-h-11 text-center" href={`/contracts/${version.id}/handoff`}>
        {version.status === "ready_for_adobe" ? "Send through Adobe" : "View contract"}
      </Link>
      <CoiNextAction contractVersionId={version.id} coiDraft={version.coiDraft} onRefresh={() => undefined} />
    </article>
  );
}
