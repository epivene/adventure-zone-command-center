import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue } from "@/lib/manager-sync-queue";
import { indexedDbManagerMutationStore } from "@/lib/manager-offline-db";
import { flushManagerBlobQueue, type ManagerBlobKind } from "@/lib/manager-blob-queue";
import { managerBackTarget } from "@/lib/manager-back-target";
import { ManagerAssistantProvider } from "@/features/manager-assistant/manager-assistant-context";
import { MessageBubbleLink } from "@/components/navigation/message-bubble-link";
import { ManagerActionCenter } from "./manager-action-center";
import { ManagerMobileNav } from "./manager-mobile-nav";

function ManagerShellInner({ children }: { children: React.ReactNode }) {
  const { manager, signOut, managerApi } = useManagerAuth();
  const [location] = useLocation();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const backTarget = managerBackTarget(location);

  useEffect(() => {
    const flush = () => void (async () => {
      await flushManagerMutationQueue(managerApi);
      await flushManagerBlobQueue(
        async row => {
          const mutations = await indexedDbManagerMutationStore.list();
          const mutation = mutations.find((candidate) => candidate.id === row.receiptId);
          const inferredKind: ManagerBlobKind | undefined = row.kind ?? (mutation?.path === "/manager/incident-attachments" ? "incident" : mutation?.path === "/manager/receipts" ? "receipt" : undefined);
          if (!inferredKind) throw new Error("Image type is unknown");
          let path: string;
          if (inferredKind === "incident") {
            path = `/manager/incident-attachments/${row.receiptId}/image`;
          } else if (inferredKind === "checklist_attachment") {
            if (!row.bookingId) throw new Error("Checklist image is missing booking context");
            path = `/manager/events/${row.bookingId}/checklist-attachments/${row.receiptId}/image`;
          } else {
            path = `/manager/receipts/${row.receiptId}/image`;
          }
          await managerApi(path, { method: "PUT", headers: { "Content-Type": row.blob.type || "image/jpeg" }, body: row.blob });
        },
        undefined,
        async row => {
          const mutations = await indexedDbManagerMutationStore.list();
          const mutation = mutations.find((candidate) => candidate.id === row.receiptId);
          if (!mutation || mutation.state !== "synced") return false;
          if (row.kind === "receipt") return mutation.path === "/manager/receipts";
          if (row.kind === "incident") return mutation.path === "/manager/incident-attachments";
          if (row.kind === "checklist_attachment") {
            return Boolean(
              row.bookingId &&
              mutation.path.startsWith(`/manager/events/${row.bookingId}/checklist-results/`) &&
              mutation.path.endsWith("/attachments"),
            );
          }
          return mutation.path === "/manager/receipts" || mutation.path === "/manager/incident-attachments";
        },
      );
    })().catch(() => undefined);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [managerApi]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await managerApi<{ conversations: Array<{ unreadCount?: number }> }>("/manager/messages/conversations");
        if (active) setUnreadMessages((data.conversations ?? []).reduce((sum, row) => sum + (row.unreadCount ?? 0), 0));
      } catch { if (active) setUnreadMessages(0); }
    };
    void refresh();
    const id = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(id); };
  }, [managerApi, location]);

  return <div className="min-h-dvh bg-background text-foreground pb-24">
    <header className="sticky top-0 z-10 border-b border-border bg-card/95 px-4 py-3 text-card-foreground backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        {backTarget ? <Link href={backTarget} className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-2 text-sm font-semibold" aria-label="Back"><ArrowLeft className="h-4 w-4"/><span className="hidden sm:inline">Back</span></Link> : null}
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Leg Manager</p><p className="truncate font-semibold">{manager?.legName}</p></div>
        <MessageBubbleLink className="ml-auto" href="/manager/messages" label="Messages" unreadCount={unreadMessages} />
      </div>
    </header>
    <ManagerActionCenter />
    <main className="mx-auto max-w-3xl p-4">{children}</main>
    <ManagerMobileNav unreadMessages={unreadMessages} onSignOut={signOut} />
  </div>;
}

export function ManagerShell({ children }: { children: React.ReactNode }) {
  const { manager } = useManagerAuth();
  const defaultContext = manager ? { kind: "leg" as const, recordId: manager.legId, label: manager.legName } : null;
  return <ManagerAssistantProvider defaultContext={defaultContext}><ManagerShellInner>{children}</ManagerShellInner></ManagerAssistantProvider>;
}
