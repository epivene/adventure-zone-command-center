import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileDesignDocuments } from "./ProfileDesignDocuments";
import { designStudioApi } from "@/lib/design-studio-api";

vi.mock("./ProfileDesignStudioPicker", () => ({
  ProfileDesignStudioPicker: ({ open }: { open: boolean }) =>
    open ? <div>Profile template picker open</div> : null,
}));

describe("ProfileDesignDocuments", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(designStudioApi, "listForProfile").mockResolvedValue([
      { id: "draft", name: "Current contract", type: "contract", status: "draft", documentYear: 2027 },
      { id: "sent", name: "2026 contract", type: "contract", status: "sent", documentYear: 2026 },
    ]);
  });

  it("groups current and previous documents and opens the picker", async () => {
    render(
      <ProfileDesignDocuments
        organizationId="00000000-0000-4000-8000-000000000001"
        documentYear={2027}
      />,
    );
    expect(await screen.findByText("Current drafts")).toBeInTheDocument();
    expect(screen.getByText("Previous years")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose template" }));
    expect(screen.getByText("Profile template picker open")).toBeInTheDocument();
  });

  it("creates a separate next-year draft", async () => {
    const reuse = vi.spyOn(designStudioApi, "useForNewYear").mockResolvedValue({
      id: "next",
      name: "Current contract | 2027",
      type: "contract",
      status: "draft",
      documentYear: 2027,
    });
    render(
      <ProfileDesignDocuments
        organizationId="00000000-0000-4000-8000-000000000001"
        documentYear={2027}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Use for new year" }));
    await waitFor(() => expect(reuse).toHaveBeenCalledWith("sent", 2027));
    expect(await screen.findByText("Current contract | 2027")).toBeInTheDocument();
  });
});
