export function assertSendRevision(approved: string, current: string) {
  if (!approved || approved !== current)
    throw new Error("ASSISTANT_SEND_REVISION_CHANGED");
}
export type SendConfirmation = {
  messageId: string;
  threadId: string;
  sentAt: string;
};
export type DeliveryState = {
  status: "prepared" | "provider_started" | "uncertain" | "sent";
  revision: string;
  confirmation: SendConfirmation | null;
  trackingComplete: boolean;
};
export interface SendDependencies {
  store: {
    load(): Promise<DeliveryState>;
    claim(): Promise<boolean>;
    confirm(result: SendConfirmation): Promise<void>;
    uncertain(): Promise<void>;
    tracked(): Promise<void>;
  };
  safety(): Promise<void>;
  provider(): Promise<SendConfirmation>;
  reconcile(): Promise<SendConfirmation | null>;
  track(result: SendConfirmation): Promise<void>;
}
export async function sendApprovedDraft(
  revision: string,
  deps: SendDependencies,
): Promise<DeliveryState> {
  let state = await deps.store.load();
  assertSendRevision(revision, state.revision);
  if (state.status === "provider_started" || state.status === "uncertain") {
    const found = await deps.reconcile();
    if (!found) return { ...state, status: "uncertain" };
    await deps.store.confirm(found);
    state = await deps.store.load();
  }
  if (state.status === "prepared") {
    await deps.safety();
    if (!(await deps.store.claim())) return { ...(await deps.store.load()) };
    try {
      // Recheck identity, cancellation, revision and dispatch protection at the boundary.
      await deps.safety();
      const confirmation = await deps.provider();
      await deps.store.confirm(confirmation);
    } catch {
      await deps.store.uncertain().catch(() => {});
      return { ...(await deps.store.load()), status: "uncertain" };
    }
    state = await deps.store.load();
  }
  if (
    state.status === "sent" &&
    state.confirmation &&
    !state.trackingComplete
  ) {
    try {
      await deps.track(state.confirmation);
      await deps.store.tracked();
    } catch {
      /* Delivery stays confirmed. Repair must only replay tracking. */
    }
  }
  return deps.store.load();
}
