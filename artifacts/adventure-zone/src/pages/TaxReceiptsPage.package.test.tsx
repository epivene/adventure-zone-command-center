import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TaxReceiptsPage from "./TaxReceiptsPage";
import { downloadAccountantPackage, listRecords } from "@/features/agent-tax/client";

vi.mock("@/features/agent-tax/client", () => ({
  listRecords: vi.fn(),
  exportCsv: vi.fn(),
  downloadAccountantPackage: vi.fn(),
  describeError: (error: Error) => error.message,
}));
vi.mock("@/components/agent-tax/RecordFormDialog", () => ({ RecordFormDialog: () => null }));
vi.mock("@/components/agent-tax/ConfirmDialogs", () => ({ DeleteRecordDialog: () => null }));
vi.mock("@/components/agent-tax/RecordList", () => ({ RecordList: () => null }));
vi.mock("@/components/agent-tax/PayTab", () => ({ PayTab: () => null }));
vi.mock("@/components/agent-tax/EstimateTab", () => ({ EstimateTab: () => null }));
vi.mock("@/components/agent-tax/SummaryCards", () => ({ SummaryCards: () => null }));
vi.mock("@workspace/avz-crm/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) =>
    <select aria-label="Tax year" value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRecords).mockResolvedValue({
    records: [], years: [2025, 2026], total: 0, storageAvailable: true,
    summary: { incomeCents: 0, expenseCents: 0, netCents: 0, recordCount: 0 },
  });
});

describe("accountant download on Tax & Receipts", () => {
  it("uses the chosen year, not search/page filters, and prevents duplicate clicks while downloading", async () => {
    let finish!: (result: "saved") => void;
    vi.mocked(downloadAccountantPackage).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<TaxReceiptsPage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "2025" })).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox", { name: "Tax year" }), { target: { value: "2025" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search entries" }), { target: { value: "no matches" } });
    fireEvent.click(screen.getByRole("button", { name: "Download accountant package" }));
    expect(downloadAccountantPackage).toHaveBeenCalledWith(2025);
    expect((screen.getByRole("button", { name: "Downloading package…" }) as HTMLButtonElement).disabled).toBe(true);
    finish("saved");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("2025 accountant package saved"));
    expect(screen.getByText(/Records and receipts are not proof of deductibility/)).toBeTruthy();
  });
  it("shows failures without claiming that a package was saved", async () => {
    vi.mocked(downloadAccountantPackage).mockRejectedValue(new Error("Private receipt storage is unavailable"));
    render(<TaxReceiptsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Download accountant package" }));
    await waitFor(() => expect(screen.getByText("Private receipt storage is unavailable").getAttribute("role")).toBe("alert"));
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByRole("button", { name: "Download accountant package" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
