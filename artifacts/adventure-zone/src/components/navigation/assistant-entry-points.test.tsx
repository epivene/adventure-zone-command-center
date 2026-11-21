import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AssistantLauncher } from "../assistant/assistant-launcher";
it("opens the shared workspace from the generic launcher", () => {
  render(<AssistantLauncher />);
  expect(screen.getByRole("link", { name: "ChatGPT connection" })).toHaveAttribute(
    "href",
    "/settings/chatgpt-connection",
  );
});
