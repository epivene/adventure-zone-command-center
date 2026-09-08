import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { bossBusinessDocumentsApi } from "@/lib/boss-documents-api";
import BusinessDocumentsPage from "./BusinessDocumentsPage";

export default function BossTemplatesFilesPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  async function uploadDocument(file?: File) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await bossBusinessDocumentsApi.upload(file);
      setReloadToken((current) => current + 1);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Could not upload the document.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const uploadAction = (
    <Button disabled={uploading} onClick={() => inputRef.current?.click()} type="button">
      <Upload className="mr-2 h-4 w-4" />{uploading ? "Uploading…" : "Upload document"}
      <input
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.jpg,.jpeg,.png,.webp"
        aria-label="Choose document to upload"
        className="sr-only"
        disabled={uploading}
        onChange={(event) => void uploadDocument(event.target.files?.[0])}
        ref={inputRef}
        type="file"
      />
    </Button>
  );

  return (
    <div className="grid gap-3">
      {uploadError ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{uploadError}</p> : null}
      <BusinessDocumentsPage
        api={bossBusinessDocumentsApi}
        eyebrow="Boss file system"
        headerAction={uploadAction}
        reloadToken={reloadToken}
      />
    </div>
  );
}
