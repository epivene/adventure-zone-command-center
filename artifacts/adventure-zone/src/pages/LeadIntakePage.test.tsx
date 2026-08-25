import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadIntakePage } from "./LeadIntakePage";

vi.mock("@/components/lead-intake/lead-import-panel", () => ({
  LeadImportPanel: ({ onImport }: { onImport: (workbook: any) => Promise<void> }) => (
    <button onClick={() => void onImport({ fileName: "Sept Week 3.xls", fileSha256: "a".repeat(64), rows: [] })} type="button">Fake import</button>
  ),
}));
vi.mock("@/components/lead-intake/lead-contact-date-review", () => ({
  LeadContactDateReview: ({ row }: { row: { company: string | null } }) => <div>Reviewing {row.company}</div>,
}));

afterEach(cleanup);

const summary = { id: "batch-1", originalFilename: "Sept Week 3.xls", status: "review" as const, rowCount: 1, importedBy: "owner", createdAt: "2026-08-25", updatedAt: "2026-08-25" };
const batch = { ...summary, rows: [{ id: "row-1", sheetName: "CompanyList", sourceRowNumber: 2, company: "Aspen Filmfest", phone: null, address1: null, address2: null, city: "Aspen", region: "CO", postalCode: null, website: "aspenfilm.org", industry: null, warnings: [], state: "needs_review" as const }] };

function reviewMethods() {
  return { searchProfiles: vi.fn(), listProfileContacts: vi.fn(), confirmReview: vi.fn() };
}

describe("LeadIntakePage", () => {
  it("shows saved imports and opens their source rows without drafting anything", async () => {
    const client = { listBatches: vi.fn().mockResolvedValue([summary]), getBatch: vi.fn().mockResolvedValue(batch), importWorkbook: vi.fn(), ...reviewMethods() };
    render(<LeadIntakePage client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /Sept Week 3.xls/ }));
    expect(await screen.findByText("Aspen Filmfest")).toBeInTheDocument();
    expect(screen.getByText(/No contact, booking, Calendar entry, or email draft is created/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review event" }));
    expect(screen.getByText("Reviewing Aspen Filmfest")).toBeInTheDocument();
  });

  it("opens the existing batch when the workbook fingerprint was already imported", async () => {
    const client = { listBatches: vi.fn().mockResolvedValue([]), getBatch: vi.fn().mockResolvedValue(batch), importWorkbook: vi.fn().mockResolvedValue({ batchId: "batch-1", reused: true, rowCount: 1 }), ...reviewMethods() };
    render(<LeadIntakePage client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Fake import" }));
    await waitFor(() => expect(client.getBatch).toHaveBeenCalledWith("batch-1"));
    expect(await screen.findByText(/already imported/)).toBeInTheDocument();
  });
});
