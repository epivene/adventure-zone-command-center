import { groupMasterWork } from "@/features/today/group-master-work";
import { GroupedWorkSection } from "./grouped-work-section";
import { useEffect, useRef, useState } from "react";

import { apiPost } from "@/lib/auth-token";
import { BUSINESS_TIME_ZONE } from "@/lib/business-date";
import type {
  MasterTodayQueue,
  MasterWorkItem,
} from "@/features/today/master-work-types";
import {
  clearTodayReturnContext,
  readTodayReturnContext,
  saveTodayReturnContext,
} from "@/features/today/today-return-context";
import { ActiveWorkQueue } from "./active-work-queue";
import { CompletedTodaySection } from "./completed-today-section";
import { NeedsAttentionSection } from "./needs-attention-section";
import { ReadyToSendSection } from "./ready-to-send-section";

function businessDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function MasterWorkQueue({
  queue,
  onChanged,
}: {
  queue: MasterTodayQueue;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const context = readTodayReturnContext();
    if (!context) return;
    requestAnimationFrame(() => {
      const item = context.workItemId
        ? document.querySelector(`[data-work-item-id="${CSS.escape(context.workItemId)}"]`)
        : null;
      if (item instanceof HTMLElement) item.scrollIntoView({ block: "center" });
      else window.scrollTo({ top: context.scrollY });
      clearTodayReturnContext();
    });
  }, []);

  function onOpen(item: MasterWorkItem, filter: string) {
    saveTodayReturnContext({ filter, workItemId: item.id, scrollY: window.scrollY });
  }

  async function mutate(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const groups = groupMasterWork(queue);
  return (
    <div className="grid gap-4" aria-label="Booking master work queue">
      <GroupedWorkSection title="Replies" items={groups.replies} onOpen={onOpen}/>
      <GroupedWorkSection title="Calls & Follow-ups" items={groups.calls} onOpen={onOpen}/>
      <GroupedWorkSection title="Booking Work" items={groups.booking} onOpen={onOpen}/>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Waiting ({groups.waiting.length})</summary><div className="mt-3"><GroupedWorkSection title="Waiting for a reply" items={groups.waiting} onOpen={onOpen}/></div></details>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Later ({groups.later.length})</summary><div className="mt-3"><GroupedWorkSection title="Scheduled work" items={groups.later} onOpen={onOpen}/></div></details>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Manage work and reviewed drafts</summary><div className="mt-3 grid gap-3"><ReadyToSendSection/>
      <ActiveWorkQueue
        items={queue.active}
        busy={busy}
        onOpen={onOpen}
        onPin={(item) => mutate(() => apiPost(`/today/work/${item.opportunityId}/pin`, { businessDate: businessDate(), pinned: !item.pinned }))}
        onUrgent={(item) => mutate(() => apiPost(`/today/work/${item.opportunityId}/urgent`, { urgent: item.priority !== "urgent" }))}
        onSnooze={(item) => mutate(() => apiPost(`/today/work/${item.opportunityId}/snooze`, { businessDate: businessDate(), until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }))}
        onReorder={(opportunityIds) => mutate(() => apiPost("/today/work/reorder", { businessDate: businessDate(), opportunityIds }))}
        onReset={() => mutate(() => apiPost("/today/work/reset-order", { businessDate: businessDate() }))}
      />
      </div></details>
      <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Completed today ({groups.completed.length})</summary><div className="mt-3"><CompletedTodaySection items={groups.completed}/></div></details>
    </div>
  );
}
