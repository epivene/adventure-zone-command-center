import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/assistant/assistant-api", () => ({
  askGeneralAssistant: vi.fn(async () => ({
    kind: "profile_results",
    text: "I found 1 matching profile.",
    results: [{
      id: "00000000-0000-4000-8000-000000000001",
      kind: "organization",
      label: "Morton County Fair",
      secondaryLabel: null,
      city: "Mandan",
      region: "ND",
      status: "possible",
      lastContactAt: null,
      bookingCount: 4,
      matchedOn: ["name"],
    }],
  })),
  askBookingAssistant: vi.fn(),
  getLatestAssistantConversation: vi.fn(),
  loadAssistantSnapshot: vi.fn(),
}));

import { AssistantContextProvider, useAssistantContext } from "@/features/assistant/assistant-context";
import { AssistantDrawer } from "./assistant-drawer";

function OpenAssistant() {
  const { openAssistant } = useAssistantContext();
  return <button onClick={() => openAssistant()}>open</button>;
}

describe("AssistantDrawer general mode", () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  it("keeps the assistant usable with no profile open and suggests supported searches", () => {
    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByText("General Command Center")).toBeTruthy();
    expect(screen.getByLabelText("Ask Booking Assistant")).not.toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Find Christmas events" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Who usually books Pirate's Rebellion?" })).toBeNull();
  });

  it("renders structured profile results from general search", async () => {
    render(
      <AssistantContextProvider>
        <OpenAssistant />
        <AssistantDrawer />
      </AssistantContextProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.change(screen.getByLabelText("Ask Booking Assistant"), { target: { value: "Find Morton County Fair" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Morton County Fair")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Use as context" })).toBeTruthy();
  });
});
