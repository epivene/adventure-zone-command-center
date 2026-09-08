import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignedContractUpload } from "./signed-contract-upload";

const mocks = vi.hoisted(() => ({ uploadSignedPdf: vi.fn(), confirmSignedFile: vi.fn() }));
vi.mock("@/features/contracts/contract-client", () => ({ contractClient: mocks }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadSignedPdf.mockResolvedValue({ file: { id: "signed-1", originalFilename: "signed.pdf", revision: 1, confirmedAt: null } });
  mocks.confirmSignedFile.mockResolvedValue({ state: { contractStatus: "completed" } });
});
afterEach(cleanup);

describe("SignedContractUpload", () => {
  it("requires filename/version review and explicit completed-agreement confirmation", async () => {
    const completed = vi.fn();
    render(<SignedContractUpload contractVersionId="version-1" versionNumber={2} onCompleted={completed} />);
    const file = new File(["%PDF-1.7\nsigned"], "signed.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Signed contract PDF"), { target: { files: [file] } });
    expect(screen.getByText("signed.pdf")).toBeInTheDocument();
    expect(screen.getByText("Contract version 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upload signed PDF" }));
    await screen.findByText("Signed PDF revision 1 stored");
    const confirm = screen.getByRole("button", { name: "Confirm completed contract" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I confirm this is the completed signed agreement"));
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.confirmSignedFile).toHaveBeenCalledWith("version-1", "signed-1", true));
    expect(completed).toHaveBeenCalled();
  });
});
