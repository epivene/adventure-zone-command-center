import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppMenu } from "./app-menu";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));

vi.mock("@/features/assistant/assistant-context", () => ({
  useAssistantContext: () => ({ openAssistant: vi.fn() }),
}));

describe("Email Review navigation", () => {
  it("shows the pending Gmail review count on mobile More and its dedicated link", async () => {
    window.history.pushState({}, "", "/today");
    render(
      <AppMenu
        mobile
        pendingEmailReviewCount={3}
        workspace="booking"
      />,
    );

    const more = screen.getByRole("button", { name: "More, 3 email reviews pending" });
    expect(more).toHaveTextContent("3");
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false });

    const link = await screen.findByRole("menuitem", { name: "Email Review, 3 pending" });
    expect(link).toHaveAttribute("href", "/email-review");
  });
});
