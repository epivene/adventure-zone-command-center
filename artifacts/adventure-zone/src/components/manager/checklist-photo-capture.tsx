import { useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";
import { flushManagerBlobQueue, queueManagerBlob } from "@/lib/manager-blob-queue";
import { ManagerSyncStatus } from "./manager-sync-status";

export function ChecklistPhotoCapture({
  bookingId,
  resultId,
  onDone,
}: {
  bookingId: string;
  resultId: string;
  onDone?: () => void;
}) {
  const { manager, managerApi } = useManagerAuth();
  const [state, setState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);
  const [message, setMessage] = useState("");

  async function select(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !manager) return;
    const id = crypto.randomUUID();
    const mimeType = file.type || "image/jpeg";

    await queueManagerMutation({
      id,
      legId: manager.legId,
      method: "POST",
      path: `/manager/events/${bookingId}/checklist-results/${resultId}/attachments`,
      body: { id, clientMutationId: id, mimeType },
      createdAt: new Date().toISOString(),
    });
    await queueManagerBlob({
      id,
      legId: manager.legId,
      receiptId: id,
      kind: "checklist_attachment",
      bookingId,
      blob: file,
      createdAt: new Date().toISOString(),
    });
    setState("saved_offline");
    setMessage("Photo saved on device. The checklist answer is saved separately.");

    if (!navigator.onLine) return;
    setState("syncing");
    const mutations = await flushManagerMutationQueue(managerApi);
    const mutation = mutations.find((row) => row.id === id);
    if (mutation?.state === "needs_attention") {
      setState("needs_attention");
      setMessage("Photo metadata needs attention. The checklist answer is still saved.");
      return;
    }
    if (mutation?.state !== "synced") {
      setState("saved_offline");
      setMessage("Photo saved on device and will upload after its checklist attachment record syncs.");
      return;
    }

    const blobs = await flushManagerBlobQueue(
      async row => {
        if (!row.bookingId) throw new Error("Checklist photo is missing event context");
        await managerApi(`/manager/events/${row.bookingId}/checklist-attachments/${row.receiptId}/image`, {
          method: "PUT",
          headers: { "Content-Type": row.blob.type || "image/jpeg" },
          body: row.blob,
        });
      },
      undefined,
      async row => row.kind === "checklist_attachment" && row.id === id,
    );
    if (blobs.find((row) => row.id === id)?.state === "image_failed") {
      setState("needs_attention");
      setMessage("Photo upload needs attention. The checklist answer is still saved.");
      return;
    }

    setState("synced");
    setMessage("Photo synced.");
    onDone?.();
  }

  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="text-sm font-semibold">
        Add photo <span className="font-normal text-slate-500">(recommended for unsafe conditions)</span>
        <input
          accept="image/*"
          capture="environment"
          className="mt-2 block w-full text-sm"
          onChange={(event) => void select(event)}
          type="file"
        />
      </label>
      {state ? <ManagerSyncStatus state={state} /> : null}
      {message ? <p className="text-xs text-slate-600">{message}</p> : null}
    </div>
  );
}
