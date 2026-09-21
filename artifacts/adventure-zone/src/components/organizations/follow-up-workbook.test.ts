import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { createFollowUpWorkbook } from "./follow-up-workbook";

const encoder = new TextEncoder();

describe("createFollowUpWorkbook", () => {
  it("creates a dated workbook with summary totals and chronological follow-ups", () => {
    const csv = [
      "Event name,Location,Next date,Deadline,Status,Recommended deal model,Next action,Contact name,Contact email,Contact phone",
      "Future Fair,Minot ND,,,Needs follow-up,,Email — 2026-09-28,,,",
      "Past Fair,Dickinson ND,,,Needs follow-up,,Call — 2026-09-20,,,",
      "Today Fair,Bismarck ND,,,Needs follow-up,,Web — 2026-09-21,,,",
    ].join("\r\n");

    const result = createFollowUpWorkbook(
      encoder.encode(csv).buffer,
      new Date("2026-09-21T12:00:00Z"),
    );
    const workbook = XLSX.read(result.data, { type: "array", cellDates: true });
    const sheet = workbook.Sheets["Follow-ups"];

    expect(result.filename).toBe("adventure-zone-follow-ups-2026-09-21.xlsx");
    expect(sheet?.B5.v).toBe(3);
    expect(sheet?.D5.v).toBe(1);
    expect(sheet?.F5.v).toBe(2);
    expect(sheet?.A8.v).toBe("Due date");
    expect(sheet?.B9.v).toBe("Overdue");
    expect(sheet?.C9.v).toBe("Call");
    expect(sheet?.D9.v).toBe("Past Fair");
    expect(sheet?.B10.v).toBe("Due today");
    expect(sheet?.D11.v).toBe("Future Fair");
    expect(sheet?.["!autofilter"]?.ref).toBe("A8:E11");
  });
});
