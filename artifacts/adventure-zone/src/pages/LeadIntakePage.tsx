import { useEffect, useState } from "react";
import { LeadImportPanel } from "@/components/lead-intake/lead-import-panel";
import { LeadContactDateReview } from "@/components/lead-intake/lead-contact-date-review";
import { LeadEmailPreviewPanel } from "@/components/lead-intake/lead-email-preview";
import { LeadCommunicationBlocks } from "@/components/lead-intake/lead-communication-blocks";
import { LeadReviewStatusControls } from "@/components/lead-intake/lead-review-status-controls";
import type { ParsedLeadWorkbook } from "@/features/lead-intake/excel-lead-parser";
import {
  leadIntakeClient,
  type LeadContactOption,
  type LeadImportBatch,
  type LeadImportBatchSummary,
  type LeadProfileOption,
} from "@/features/lead-intake/lead-intake-client";

type Client = {
  importWorkbook(workbook: ParsedLeadWorkbook): Promise<{ batchId: string; reused: boolean; rowCount: number }>;
  listBatches(): Promise<LeadImportBatchSummary[]>;
  getBatch(batchId: string): Promise<LeadImportBatch>;
  searchProfiles(query: string): Promise<LeadProfileOption[]>;
  listProfileContacts(organizationId: string): Promise<LeadContactOption[]>;
  confirmReview(rowId: string, body: unknown): Promise<{ rowId: string; state: "verified"; reviewVersion: number }>;
  updateReviewStatus?: (rowId: string, body: { expectedVersion: number; territoryStatus: string; fitStatus: string }) => Promise<unknown>;
  getEmailPreview?: (rowId: string) => Promise<any>;
  listCommunicationBlocks?: () => Promise<any[]>;
  createCommunicationBlock?: (body: unknown) => Promise<unknown>;
  removeCommunicationBlock?: (id: string, reason: string) => Promise<unknown>;
};

export function LeadIntakePage({ client }: { client: Client }) {
  const [batches, setBatches] = useState<LeadImportBatchSummary[]>([]);
  const [selected, setSelected] = useState<LeadImportBatch | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadBatches() {
    setBatches(await client.listBatches());
  }

  useEffect(() => {
    let active = true;
    client.listBatches()
      .then((value) => { if (active) setBatches(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load lead imports."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client]);

  async function importWorkbook(workbook: ParsedLeadWorkbook) {
    setError("");
    const result = await client.importWorkbook(workbook);
    await loadBatches();
    setSelected(await client.getBatch(result.batchId));
    setNotice(result.reused
      ? "This workbook was already imported. Its existing review batch is open."
      : `${result.rowCount} event rows were saved for review.`);
  }

  async function openBatch(batchId: string) {
    setError("");
    try { setSelected(await client.getBatch(batchId)); setSelectedRowId(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open this lead import."); }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 pb-12">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Booking &amp; Leads</p>
        <h1 className="mt-1 text-3xl font-bold">Excel lead review</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Import Amy's lists, then verify each event and contact before checking Google Calendar or creating any Gmail draft.
        </p>
      </header>
      <LeadImportPanel onImport={importWorkbook} />
      {notice ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{notice}</p> : null}
      {error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}

      <section className="grid gap-3">
        <h2 className="text-xl font-bold">Saved lead lists</h2>
        {loading ? <p className="text-sm text-slate-500">Loading saved imports…</p> : null}
        {!loading && batches.length === 0 ? <p className="rounded-xl border border-dashed bg-white p-4 text-sm text-slate-600">No Excel lead lists have been imported yet.</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {batches.map((batch) => (
            <button className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-orange-300" key={batch.id} onClick={() => void openBatch(batch.id)} type="button">
              <span className="block font-bold">{batch.originalFilename}</span>
              <span className="mt-1 block text-sm text-slate-600">{batch.rowCount} events · Imported by {batch.importedBy}</span>
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="grid gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-orange-700">Review queue</p>
            <h2 className="text-2xl font-bold">{selected.originalFilename}</h2>
            <p className="text-sm text-slate-600">No contact, booking, Calendar entry, or email draft is created at this stage.</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50"><tr><th className="p-3">Source</th><th className="p-3">Event</th><th className="p-3">Location</th><th className="p-3">Contact clues</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
              <tbody>{selected.rows.map((row) => (
                <tr className="border-t border-slate-100" key={row.id}>
                  <td className="p-3">{row.sheetName} · row {row.sourceRowNumber}</td>
                  <td className="p-3 font-semibold">{row.company ?? "Missing event/profile name"}</td>
                  <td className="p-3">{[row.city, row.region].filter(Boolean).join(", ") || "Missing"}</td>
                  <td className="p-3">{row.phone ?? row.website ?? "Needs research"}</td>
                  <td className="p-3"><span className={row.state === "needs_correction" ? "rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-900" : "rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700"}>{row.state.replaceAll("_", " ")}</span></td>
                  <td className="p-3"><button className="button-secondary" onClick={() => setSelectedRowId(row.id)} type="button">Review event</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {selected.rows.find((row) => row.id === selectedRowId) ? (
            <LeadContactDateReview
              client={client}
              key={selectedRowId}
              onSaved={async () => {
                const refreshed = await client.getBatch(selected.id);
                setSelected(refreshed);
                setSelectedRowId(selectedRowId);
              }}
              row={selected.rows.find((row) => row.id === selectedRowId)!}
            />
          ) : null}
          {client.updateReviewStatus && selected.rows.find((row) => row.id === selectedRowId) ? <LeadReviewStatusControls row={selected.rows.find((row) => row.id === selectedRowId)!} save={(body) => client.updateReviewStatus!(selectedRowId!, body)} /> : null}
          {client.getEmailPreview && selectedRowId ? <LeadEmailPreviewPanel rowId={selectedRowId} load={client.getEmailPreview} /> : null}
          {client.listCommunicationBlocks && client.createCommunicationBlock && client.removeCommunicationBlock ? <LeadCommunicationBlocks list={client.listCommunicationBlocks} create={client.createCommunicationBlock} remove={client.removeCommunicationBlock} /> : null}
        </section>
      ) : null}
    </div>
  );
}

export default function LeadIntakeRoutePage() {
  return <LeadIntakePage client={leadIntakeClient} />;
}
