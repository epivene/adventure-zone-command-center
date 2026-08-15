// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerIncidentsPage from "./ManagerIncidentsPage";

const mocks = vi.hoisted(() => ({
  managerApi: vi.fn(async () => ({
    incidents: [{
      id: "incident-1",
      type: "injury",
      description: "Minor injury",
      followUpNeeded: true,
      attachments: [{
        id: "photo-1",
        imageStatus: "image_uploaded",
        imageUrl: "https://example.test/manager-incident.jpg",
        mimeType: "image/jpeg",
      }],
    }],
  })),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ managerApi: mocks.managerApi }),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ManagerIncidentsPage", () => {
  it("shows uploaded incident photos with a full-size link", async () => {
    render(<ManagerIncidentsPage />);
    const image = await screen.findByRole("img", { name: "Incident photo" });
    expect(image).toHaveAttribute("src", "https://example.test/manager-incident.jpg");
    expect(screen.getByRole("link", { name: "View incident photo" })).toHaveAttribute("href", "https://example.test/manager-incident.jpg");
  });
});
