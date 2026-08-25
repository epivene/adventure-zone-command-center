import { useState } from "react";
import type { ParsedLeadWorkbook } from "@/features/lead-intake/excel-lead-parser";
import { parseLeadWorkbook } from "@/features/lead-intake/excel-lead-parser";

export function LeadImportPanel({
  onImport,
}: {
  onImport: (workbook: ParsedLeadWorkbook) => Promise<void> | void;
}) {
  const [preview, setPreview] = useState<ParsedLeadWorkbook | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  async function chooseFile(file: File | undefined) {
    setPreview(null);
    setError("");
    if (!file) return;
    setLoading(true);
    try {
      const bytes = await readFileBytes(file);
      setPreview(await parseLeadWorkbook(bytes, file.name));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workbook could not be read.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmImport() {
    if (!preview || importing) return;
    setImporting(true);
    setError("");
    try {
      await onImport(preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The lead list could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h2 className="text-xl font-bold">Import Amy's Excel lead list</h2>
        <p className="mt-1 text-sm text-slate-600">
          Preview every row first. This does not create contacts or email drafts.
        </p>
      </header>
      <label className="grid gap-2 text-sm font-semibold" htmlFor="lead-excel-file">
        Excel lead list
        <input
          accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full rounded-lg border border-slate-300 p-2"
          id="lead-excel-file"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
          type="file"
        />
      </label>
      {loading ? <p role="status">Reading workbook…</p> : null}
      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}
      {preview ? (
        <div className="grid gap-3">
          <div>
            <p className="font-bold">{preview.fileName}</p>
            <p className="text-sm text-slate-600">
              {preview.rows.length} {preview.rows.length === 1 ? "event" : "events"} ready for review
            </p>
          </div>
          {preview.warnings.length ? (
            <ul className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              {preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Row</th><th className="p-2">Event</th><th className="p-2">Location</th><th className="p-2">Website</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 25).map((row) => (
                  <tr className="border-t border-slate-100" key={`${row.sheetName}:${row.rowNumber}`}>
                    <td className="p-2">{row.rowNumber}</td>
                    <td className="p-2 font-semibold">{row.company || "Missing company"}</td>
                    <td className="p-2">{[row.city, row.state].filter(Boolean).join(", ") || "Missing"}</td>
                    <td className="p-2">{row.website || "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 25 ? <p className="text-xs text-slate-500">Showing the first 25 rows.</p> : null}
          <button className="button-primary justify-self-start" disabled={importing} onClick={() => void confirmImport()} type="button">
            {importing ? "Importing…" : "Import for review"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The workbook could not be read."));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}
