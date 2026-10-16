import { useState } from "react";
import { Alert, AlertDescription } from "@workspace/avz-crm/components/ui/alert";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@workspace/avz-crm/components/ui/alert-dialog";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { deleteRecord, describeError, removeFile, type TaxRecord } from "@/features/agent-tax/client";

function Confirm({ open, title, body, action, busy, error, onCancel, onConfirm }: {
  open: boolean; title: string; body: string; action: string; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? "Working" : action}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteRecordDialog({ record, onCancel, onDeleted }: { record: TaxRecord | null; onCancel: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Confirm
      open={!!record} busy={busy} error={error} action="Delete entry" title="Delete this entry?"
      body={`"${record?.title ?? ""}" and any attached file will be permanently deleted. This cannot be undone.${record?.payItemId ? " Deleting this payment income entry restores the balance owed on its pay entry." : ""}`}
      onCancel={() => { setError(null); onCancel(); }}
      onConfirm={async () => {
        if (!record) return;
        setBusy(true); setError(null);
        try { await deleteRecord(record.id, record.revision); onDeleted(); }
        catch (e) { setError(describeError(e)); } finally { setBusy(false); }
      }}
    />
  );
}

export function RemoveFileDialog({ record, onCancel, onRemoved }: { record: TaxRecord | null; onCancel: () => void; onRemoved: (r: TaxRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Confirm
      open={!!record} busy={busy} error={error} action="Remove file" title="Remove the attachment?"
      body={`The file "${record?.fileName ?? ""}" will be permanently removed. The entry itself is kept.`}
      onCancel={() => { setError(null); onCancel(); }}
      onConfirm={async () => {
        if (!record) return;
        setBusy(true); setError(null);
        try { onRemoved(await removeFile(record.id, record.revision)); }
        catch (e) { setError(describeError(e)); } finally { setBusy(false); }
      }}
    />
  );
}
