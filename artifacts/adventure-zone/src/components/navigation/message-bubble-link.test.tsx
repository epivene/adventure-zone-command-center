// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import { MessageBubbleLink } from "./message-bubble-link";

afterEach(cleanup);

describe("MessageBubbleLink", () => {
  it("shows a numeric unread badge when messages are unread", () => {
    render(<MessageBubbleLink href="/manager/messages" label="Messages" unreadCount={3} />);
    expect(screen.getByRole("link", { name: /messages, 3 unread/i })).toHaveAttribute("href", "/manager/messages");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("caps large unread counts and hides the badge at zero", () => {
    const { rerender } = render(<MessageBubbleLink href="/manager/messages" label="Messages" unreadCount={12} />);
    expect(screen.getByText("9+")).toBeInTheDocument();
    rerender(<MessageBubbleLink href="/manager/messages" label="Messages" unreadCount={0} />);
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Messages" })).toBeInTheDocument();
  });
});
