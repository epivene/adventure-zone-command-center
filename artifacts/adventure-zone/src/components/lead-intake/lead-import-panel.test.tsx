import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadImportPanel } from "./lead-import-panel";

afterEach(cleanup);

function leadFile() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Company", "Phone", "City", "State", "Web Site", "Industry"],
      ["Aspen Filmfest", "970-555-0100", "Aspen", "CO", "aspenfilm.org", "Festival"],
    ]),
    "CompanyList",
  );
  const bytes = XLSX.write(workbook, { bookType: "biff8", type: "array" }) as ArrayBuffer;
  return new File([bytes], "Sept Week 3.xls", { type: "application/vnd.ms-excel" });
}

describe("LeadImportPanel", () => {
  it("previews an Excel lead list without importing it automatically", async () => {
    const onImport = vi.fn();
    render(<LeadImportPanel onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("Excel lead list"), {
      target: { files: [leadFile()] },
    });

    await screen.findByText("Aspen Filmfest");
    expect(screen.getByText("1 event ready for review")).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("imports the parsed preview only after explicit confirmation", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<LeadImportPanel onImport={onImport} />);

    fireEvent.change(screen.getByLabelText("Excel lead list"), {
      target: { files: [leadFile()] },
    });
    await screen.findByText("Aspen Filmfest");
    fireEvent.click(screen.getByRole("button", { name: "Import for review" }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toEqual(expect.objectContaining({
      fileName: "Sept Week 3.xls",
      rows: [expect.objectContaining({ company: "Aspen Filmfest", rowNumber: 2 })],
    }));
  });
});
