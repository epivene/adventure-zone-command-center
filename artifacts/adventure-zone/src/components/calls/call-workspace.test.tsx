import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/activities/activity-timeline", () => ({ ActivityTimeline: () => null }));

import { CallWorkspace } from "./call-workspace";

afterEach(cleanup);

describe("CallWorkspace completion contract", () => {
  it("submits outgoing mobile-log metadata without browser snapshots", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "70000000-0000-4000-8000-000000000001" });
    const onComplete = vi.fn().mockResolvedValue({ ok: true });
    render(<CallWorkspace activityParent={{ type: "contact", id: "20000000-0000-4000-8000-000000000001" }} booking={null} contact={{ id: "20000000-0000-4000-8000-000000000001", name: "Avery Lee", phone: "701-555-0100", email: null, city: null, region: null }} followUp={{ id: "60000000-0000-4000-8000-000000000001", kind: "call", dueAt: new Date("2026-08-13T15:00:00.000Z") }} onComplete={onComplete} organization={{ id: "10000000-0000-4000-8000-000000000001", name: "Acme Venue", lastResort: false, lastResortReason: null }} timeline={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Start call note" }));
    fireEvent.change(screen.getByLabelText("Call note"), { target: { value: "Discussed the event." } });
    fireEvent.click(screen.getByRole("button", { name: "Save call note" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ direction: "outgoing", method: "mobile_log", phoneId: null, scriptKind: "follow_up", doNotCallConfirmed: false, doNotCallReason: null })));
    expect(onComplete.mock.calls[0]?.[0]).not.toHaveProperty("phoneNumberSnapshot");
    expect(onComplete.mock.calls[0]?.[0]).not.toHaveProperty("phoneExtensionSnapshot");
  });
});
