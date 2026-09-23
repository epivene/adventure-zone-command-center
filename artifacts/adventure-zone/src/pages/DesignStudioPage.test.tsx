import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DesignStudioPage from "./DesignStudioPage";
import { designStudioApi, type DesignTemplate } from "@/lib/design-studio-api";

const { setLocation } = vi.hoisted(() => ({ setLocation: vi.fn() }));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/design-studio", setLocation] as const,
}));

const templates: DesignTemplate[] = [
  { id: "e1", name: "General first outreach", type: "email", templateFamily: "email", state: "active" },
  { id: "c1", name: "Adventure Zone | Guaranteed fee", type: "contract", templateFamily: "contract", state: "active" },
  { id: "p1", name: "Mini Zone prepaid", type: "proposal", templateFamily: "proposal", state: "active" },
];

describe("DesignStudioPage current catalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocation.mockReset();
    vi.spyOn(designStudioApi, "list").mockResolvedValue([]);
    vi.spyOn(designStudioApi, "listTemplates").mockResolvedValue(templates);
  });

  it("shows only the current email, contract, and proposal catalog", async () => {
    render(<DesignStudioPage />);
    expect(await screen.findByRole("tab", { name: "Emails (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Contracts (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Proposals (1)" })).toBeInTheDocument();
    expect(screen.queryByText("Fun, photo-heavy starter templates")).not.toBeInTheDocument();
    expect(screen.queryByText("Agreement outline")).not.toBeInTheDocument();
  });

  it("creates an editable draft without sending it", async () => {
    const user = userEvent.setup();
    const instantiate = vi.spyOn(designStudioApi, "instantiateTemplate").mockResolvedValue({
      id: "project-1",
      name: "General first outreach",
      type: "email",
      status: "draft",
    });
    render(<DesignStudioPage />);
    await user.click(await screen.findByRole("button", { name: "Use this template" }));
    expect(instantiate).toHaveBeenCalledWith("e1", {
      documentYear: new Date().getFullYear(),
    });
    expect(setLocation).toHaveBeenCalledWith("/design-studio/project-1");
  });
});
