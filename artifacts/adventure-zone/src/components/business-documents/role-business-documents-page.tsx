import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import type { BusinessDocumentCategory } from "@/lib/business-documents-api";
import BusinessDocumentsPage, { type BusinessDocumentsClient } from "@/pages/BusinessDocumentsPage";

const categoryOptions: Array<{ value: BusinessDocumentCategory; label: string }> = [
  { value: "contract", label: "Contract" },
  { value: "invoice", label: "Invoice" },
  { value: "proposal", label: "Proposal" },
  { value: "coi", label: "COI / certificate of insurance" },
  { value: "insurance_policy", label: "Insurance policy" },
  { value: "w9_tax", label: "W-9 / tax document" },
  { value: "permit", label: "Permit" },
  { value: "vendor_application", label: "Vendor application" },
  { value: "inspection", label: "Inspection" },
  { value: "deposit_receipt", label: "Deposit receipt" },
  { value: "operational_template", label: "Operational template" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

type RoleDocumentClient = BusinessDocumentsClient & {
  upload(file: File, metadata: { displayName: string; category: BusinessDocumentCategory }): Promise<unknown>;
};

function filenameStem(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replaceAll(/[-_]+/g, " ").trim();
}

export function RoleBusinessDocumentsPage({
  api,
  eyebrow,
}: {
  api: RoleDocumentClient;
  eyebrow: string;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState<BusinessDocumentCategory>("other");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  function closeUpload() {
    if (uploading) return;
    setUploadOpen(false);
    setFile(null);
    setDisplayName("");
    setCategory("other");
    setUploadError(null);
  }

  async function uploadDocument() {
    const name = displayName.trim();
    if (!file || !name) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.upload(file, { displayName: name, category });
      setReloadToken((current) => current + 1);
      setUploadOpen(false);
      setFile(null);
      setDisplayName("");
      setCategory("other");
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Could not upload the document.");
    } finally {
      setUploading(false);
    }
  }

  const uploadAction = (
    <Button onClick={() => setUploadOpen(true)} type="button">
      <Upload className="mr-2 h-4 w-4" />Upload document
    </Button>
  );

  return (
    <div className="grid gap-3">
      {uploadOpen ? (
        <section aria-label="Upload document" aria-modal="true" className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm" role="dialog">
          <div>
            <h2 className="text-lg font-bold">Upload document</h2>
            <p className="text-sm text-muted-foreground">Choose the file, the name people should see, and where it belongs.</p>
          </div>
          <label className="grid gap-1 text-sm font-semibold">Document file
            <input aria-label="Document file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.jpg,.jpeg,.png,.webp" disabled={uploading} onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setFile(selected);
              if (selected && !displayName.trim()) setDisplayName(filenameStem(selected.name));
            }} type="file" />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Document name
            <input aria-label="Document name" disabled={uploading} maxLength={255} onChange={(event) => setDisplayName(event.target.value)} value={displayName} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Category
            <select aria-label="Upload category" disabled={uploading} onChange={(event) => setCategory(event.target.value as BusinessDocumentCategory)} value={category}>
              {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {uploadError ? <p className="text-sm font-semibold text-destructive" role="alert">{uploadError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={uploading || !file || !displayName.trim()} onClick={() => void uploadDocument()} type="button">
              {uploading ? "Uploading…" : "Upload selected document"}
            </Button>
            <Button disabled={uploading} onClick={closeUpload} type="button" variant="outline">Cancel</Button>
          </div>
        </section>
      ) : null}
      <BusinessDocumentsPage api={api} eyebrow={eyebrow} headerAction={uploadAction} reloadToken={reloadToken} />
    </div>
  );
}
