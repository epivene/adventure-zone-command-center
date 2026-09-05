import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DesignStudioEditorPage from "./DesignStudioEditorPage";
import { designStudioApi } from "@/lib/design-studio-api";
import { starterById } from "@/lib/design-studio/canva-starters";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useParams: () => ({ id: "project-1" }),
}));

describe("DesignStudioEditorPage", () => {
  let projectType: "flyer" | "email";

  beforeEach(() => {
    vi.restoreAllMocks();
    projectType = "flyer";
    const starter = starterById("event-flyer")!;
    vi.spyOn(designStudioApi, "get").mockResolvedValue({
      id: "project-1",
      name: "Big Day Event Flyer",
      get type() { return projectType; },
      status: "draft",
      canvas: starter.canvas as unknown as Record<string, unknown>,
    });
    vi.spyOn(designStudioApi, "listAssets").mockResolvedValue([]);
    vi.spyOn(designStudioApi, "getCanvaState").mockResolvedValue({
      configured: false, connected: false, linked: false, designId: null,
      importedVersionId: null, currentVersionId: null, outdated: false,
      linkStatus: null, lastError: null,
    });
    vi.spyOn(designStudioApi, "update").mockImplementation(async (_id, input) => ({
      id: "project-1",
      name: String(input.name ?? "Big Day Event Flyer"),
      type: "flyer",
      status: "draft",
      canvas: input.canvas ?? starter.canvas as unknown as Record<string, unknown>,
    }));
  });

  it("opens the persisted project canvas instead of the copy-to-Canva textarea", async () => {
    render(<DesignStudioEditorPage />);

    expect(await screen.findByTestId("design-canvas")).toBeInTheDocument();
    expect(await screen.findByTestId("freeform-surface")).toBeInTheDocument();
    expect(screen.queryByText(/copy into canva/i)).not.toBeInTheDocument();
  });

  it("uses the branded email editor only for email projects", async () => {
    projectType = "email";
    render(<DesignStudioEditorPage />);

    expect(await screen.findByTestId("branded-email-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("freeform-surface")).not.toBeInTheDocument();
  });

  it("keeps the freeform editor for non-email projects", async () => {
    render(<DesignStudioEditorPage />);

    expect(await screen.findByTestId("freeform-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("branded-email-editor")).not.toBeInTheDocument();
  });

  it("renders the hero photograph without tint or opacity classes", async () => {
    projectType = "email";
    render(<DesignStudioEditorPage />);

    const hero = await screen.findByTestId("email-hero-image");
    expect(hero.className).not.toMatch(/opacity|mix-blend|filter/);
  });
});
