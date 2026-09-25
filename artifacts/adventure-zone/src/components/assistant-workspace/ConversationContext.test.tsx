import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversationContext } from "./ConversationContext";
it("shows limited coverage and links to originals, then clears on conversation change", () => {
  const { rerender } = render(
    <ConversationContext
      summary={{
        schemaVersion: 1,
        totalMessageCount: 31,
        recentMessageCount: 6,
        omittedMessageCount: 24,
        entries: [
          {
            messageId: "m1",
            excerpt: "Earlier correction",
            role: "user",
            truncated: true,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/24 older messages were outside/)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Open original message", hidden: true })
      .getAttribute("href"),
  ).toBe("#message-m1");
  expect(screen.getByText("Earlier correction…")).toBeTruthy();
  rerender(<ConversationContext summary={{}} />);
  expect(screen.queryByText("Earlier conversation context")).toBeNull();
});
