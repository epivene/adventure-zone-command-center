import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DesignStudioPage from "./DesignStudioPage";
import { designStudioApi } from "@/lib/design-studio-api";

const { setLocation } = vi.hoisted(() => ({ setLocation: vi.fn() }));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/design-studio", setLocation] as const,
}));

describe("DesignStudioPage starter creation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLocation.mockReset();
    vi.spyOn(designStudioApi, "list").mockResolvedValue([]);
  });

  it("creates a project with the selected starter canvas", async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(designStudioApi, "create").mockResolvedValue({
      id: "project-1",
      name: "Big Day Event Flyer",
      type: "flyer",
    });

    render(<DesignStudioPage />);
    await user.click((await screen.findAllByRole("button", { name: /use this design/i }))[0]!);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Big Day Event Flyer",
        canvas: expect.objectContaining({ pages: expect.any(Array) }),
      }),
    );
    expect(setLocation).toHaveBeenCalledWith("/design-studio/project-1");
  });

  it("shows the current $8,000 Pirate and Warrior prices in the package preview", async () => {
    render(<DesignStudioPage />);

    expect((await screen.findAllByText("$8,000"))).toHaveLength(2);
    expect(screen.queryByText("$7,500")).not.toBeInTheDocument();
  });
});
