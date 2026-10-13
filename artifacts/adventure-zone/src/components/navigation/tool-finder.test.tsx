import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolFinder, type ToolFinderItem } from "./tool-finder";

const { setLocationMock } = vi.hoisted(() => ({ setLocationMock: vi.fn() }));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
  useLocation: () => ["/", setLocationMock],
}));

const items: ToolFinderItem[] = [
  { href: "/emails", label: "Emails", category: "Workspace" },
  { href: "/website-inquiries", label: "Website Inquiries", category: "Workspace", keywords: ["web", "inquiry", "inquiries", "contact form"] },
];

describe("tool finder", () => {
  beforeEach(() => setLocationMock.mockClear());

  it("finds Website Inquiries by typing web or inquiry", () => {
    render(<ToolFinder items={items} />);
    const search = screen.getByRole("searchbox", { name: "Search pages and tools" });

    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "web" } });
    expect(screen.getByRole("link", { name: /Website Inquiries/ })).toHaveAttribute("href", "/website-inquiries");

    fireEvent.change(search, { target: { value: "inquiry" } });
    expect(screen.getByRole("link", { name: /Website Inquiries/ })).toHaveAttribute("href", "/website-inquiries");
  });

  it("opens the first match when Enter is pressed", () => {
    render(<ToolFinder items={items} />);
    const search = screen.getByRole("searchbox", { name: "Search pages and tools" });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "web" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(setLocationMock).toHaveBeenCalledWith("/website-inquiries");
  });

  it("shows a helpful empty state when nothing matches", () => {
    render(<ToolFinder items={items} />);
    const search = screen.getByRole("searchbox", { name: "Search pages and tools" });
    fireEvent.focus(search);
    fireEvent.change(search, { target: { value: "unknown destination" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching pages or tools.");
  });
});
