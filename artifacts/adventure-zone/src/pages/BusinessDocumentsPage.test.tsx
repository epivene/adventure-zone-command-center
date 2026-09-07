// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/business-documents-api", () => ({
  businessDocumentsApi: { list: mocks.list },
}));

import BusinessDocumentsPage from "./BusinessDocumentsPage";

beforeEach(() => {
  mocks.list.mockReset();
  mocks.list.mockResolvedValue({ documents: [] });
});

describe("BusinessDocumentsPage", () => {
  it("shows one library with the approved four views", async () => {
    render(<BusinessDocumentsPage />);
    expect(await screen.findByRole("tab", { name: "All Documents" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Templates" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "COIs & Insurance" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Needs Review" })).toBeVisible();
  });

  it("explains that an empty library can import or upload files", async () => {
    render(<BusinessDocumentsPage />);
    expect(await screen.findByText("No business documents yet")).toBeVisible();
    expect(screen.getByRole("link", { name: "Import business documents" })).toHaveAttribute("href", "/business-documents/import");
  });
});
