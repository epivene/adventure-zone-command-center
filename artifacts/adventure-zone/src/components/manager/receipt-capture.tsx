import { useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue, queueManagerMutation } from "@/lib/manager-sync-queue";
import { queueManagerBlob, flushManagerBlobQueue } from "@/lib/manager-blob-queue";
import { ManagerSyncStatus } from "./manager-sync-status";

export function ReceiptCapture({ expenseId, onDone }: { expenseId: string; onDone?: () => void }) {
  const { manager, managerApi } = useManagerAuth();
  const [state, setState] = useState<"saved_offline" | "syncing" | "synced" | "needs_attention" | null>(null);

  async function select(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !manager) return;
    const id = crypto.randomUUID();
    await queueManagerMutation({
      id,
      legId: manager.legId,
      method: "POST",
      path: "/manager/receipts",
      body: { id, expenseId, clientMutationId: id, mimeType: file.type || "image/jpeg" },
      createdAt: new Date().toISOString(),
    });
    await queueManagerBlob({ id, legId: manager.legId, receiptId: id, kind: "receipt", blob: file, createdAt: new Date().toISOString() });
    setState("saved_offline");
    if (navigator.onLine) {
      setState("syncing");
      const mutations = await flushManagerMutationQueue(managerApi);
      if (mutations.find((row) => row.id === id)?.state === "needs_attention") {
        setState("needs_attention");
        return;
      }
      const blobs = await flushManagerBlobQueue(
        async row => {
          await managerApi(`/manager/receipts/${row.receiptId}/image`, {
            method: "PUT",
            headers: { "Content-Type": row.blob.type || "image/jpeg" },
            body: row.blob,
          });
        },
        undefined,
        async row => row.kind === "receipt" && row.receiptId === id,
      );
      if (blobs.find((row) => row.id === id)?.state === "image_failed") {
        setState("needs_attention");
        return;
      }
      setState("synced");
      onDone?.();
    }
  }

  return <div className="grid gap-2 rounded-xl border bg-white p-4">
    <label className="font-semibold">Receipt photo<input className="mt-2 block" type="file" accept="image/*" capture="environment" onChange={select} /></label>
    {state ? <ManagerSyncStatus state={state} /> : null}
  </div>;
}
