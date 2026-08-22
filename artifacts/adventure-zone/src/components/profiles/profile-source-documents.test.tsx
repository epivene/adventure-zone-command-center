// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  officeGet: vi.fn(),
}));
vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet, apiPost: mocks.apiPost }));
vi.mock("@/lib/office-auth-context", () => ({ officeGet: mocks.officeGet }));

import { ProfileSourceDocuments } from "./profile-source-documents";

const ravalli = {
  id: "doc-1",
  title: "Ravalli County Fair Pirate's Rebellion Contract",
  category: "contract",
  effectiveYear: 2025,
  hasFile: true,
  canOpenFile: true,
  historicalTerms: [
    { label: "Negotiated convention rate", value: "630000", sourceLocator: "Contract p.1" },
  ],
};

beforeEach(() => {
  mocks.apiGet.mockReset();
  mocks.apiPost.mockReset();
  mocks.officeGet.mockReset();
  vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("ProfileSourceDocuments", () => {
  it("shows owner-linked historical documents and reviewed terms", async () => {
    mocks.apiGet.mockResolvedValue({ sourceDocuments: [ravalli] });
    render(<ProfileSourceDocuments mode="owner" profileId="11111111-1111-4111-8111-111111111111" />);
    expect(await screen.findByText("Ravalli County Fair Pirate's Rebellion Contract")).toBeInTheDocument();
    expect(screen.getByText("Negotiated convention rate: 630000")).toBeInTheDocument();
    expect(screen.getByText("Contract p.1")).toBeInTheDocument();
    expect(mocks.apiGet).toHaveBeenCalledWith("/event-profiles/11111111-1111-4111-8111-111111111111/source-documents");
    expect(screen.getByRole("button", { name: "Open document" })).toBeInTheDocument();
  });

  it("uses only the Office-filtered endpoint in Office mode", async () => {
    mocks.officeGet.mockResolvedValue({ sourceDocuments: [] });
    const { container } = render(<ProfileSourceDocuments mode="office" profileId="22222222-2222-4222-8222-222222222222" />);
    await waitFor(() => expect(mocks.officeGet).toHaveBeenCalled());
    expect(mocks.officeGet).toHaveBeenCalledWith("/office/profiles/22222222-2222-4222-8222-222222222222/source-documents");
    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("does not store a signed URL after the owner open action", async () => {
    mocks.apiGet.mockResolvedValue({ sourceDocuments: [ravalli] });
    mocks.apiPost.mockResolvedValue({ url: "https://signed.example/file" });
    render(<ProfileSourceDocuments mode="owner" profileId="33333333-3333-4333-8333-333333333333" />);
    fireEvent.click(await screen.findByRole("button", { name: "Open document" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/business-sources/doc-1/file/open", {}));
    expect(window.open).toHaveBeenCalledWith("https://signed.example/file", "_blank", "noopener,noreferrer");
    expect(screen.queryByText("https://signed.example/file")).not.toBeInTheDocument();
  });
});
