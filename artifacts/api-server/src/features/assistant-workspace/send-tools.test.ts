import { it, expect, vi } from "vitest";
import { assertSendRevision, sendApprovedDraft } from "./send-tools";
it("requires the exact approved revision", () => {
  expect(() => assertSendRevision("one", "two")).toThrow(
    "ASSISTANT_SEND_REVISION_CHANGED",
  );
});
function setup() {
  let state: any = {
    status: "prepared",
    revision: "rev",
    confirmation: null,
    trackingComplete: false,
  };
  return {
    store: {
      load: async () => state,
      claim: async () => {
        if (state.status !== "prepared") return false;
        state = { ...state, status: "provider_started" };
        return true;
      },
      confirm: async (confirmation: any) => {
        state = { ...state, status: "sent", confirmation };
      },
      uncertain: async () => {
        state = { ...state, status: "uncertain" };
      },
      tracked: async () => {
        state.trackingComplete = true;
      },
    },
    safety: vi.fn().mockResolvedValue(undefined),
    provider: vi.fn().mockResolvedValue({
      messageId: "m",
      threadId: "t",
      sentAt: "2026-09-24T12:00:00Z",
    }),
    reconcile: vi.fn().mockResolvedValue(null),
    track: vi.fn().mockResolvedValue(undefined),
  };
}
it("tracking retries never resend a confirmed message", async () => {
  const d = setup();
  d.track.mockRejectedValueOnce(new Error("database down"));
  expect((await sendApprovedDraft("rev", d)).trackingComplete).toBe(false);
  expect((await sendApprovedDraft("rev", d)).trackingComplete).toBe(true);
  expect(d.provider).toHaveBeenCalledTimes(1);
});
it("uncertain delivery never blindly resends", async () => {
  const d = setup();
  d.provider.mockRejectedValueOnce(new Error("timeout"));
  expect((await sendApprovedDraft("rev", d)).status).toBe("uncertain");
  expect((await sendApprovedDraft("rev", d)).status).toBe("uncertain");
  expect(d.provider).toHaveBeenCalledTimes(1);
  expect(d.reconcile).toHaveBeenCalled();
});
it("requires safety before provider invocation", async () => {
  const d = setup();
  d.safety.mockRejectedValue(new Error("blocked contact"));
  await expect(sendApprovedDraft("rev", d)).rejects.toThrow("blocked contact");
  expect(d.provider).not.toHaveBeenCalled();
});
it("concurrent sends invoke the provider only once", async () => {
  const d = setup();
  await Promise.all([sendApprovedDraft("rev", d), sendApprovedDraft("rev", d)]);
  expect(d.provider).toHaveBeenCalledTimes(1);
});
