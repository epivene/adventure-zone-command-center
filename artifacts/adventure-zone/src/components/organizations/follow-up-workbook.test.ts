import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { createFollowUpWorkbook } from "./follow-up-workbook";

describe("createFollowUpWorkbook", () => {
  it("creates a dated workbook with summary totals and chronological follow-ups", () => {
    const result = createFollowUpWorkbook(
      [
        { id: "1", kind: "Email", dueAt: "2026-09-28T17:00:00Z", organizationName: "Future Fair", city: "Minot", region: "ND" },
        { id: "2", kind: "Call", dueAt: "2026-09-20T17:00:00Z", organizationName: "Past Fair", city: "Dickinson", region: "ND" },
        { id: "3", kind: "Web", dueAt: "2026-09-21T17:00:00Z", organizationName: "Today Fair", city: "Bismarck", region: "ND" },
      ],
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

  it("uses the Central business date for status and the filename", () => {
    const result = createFollowUpWorkbook(
      [{ id: "1", kind: "Call", dueAt: "2026-09-21T17:00:00Z", organizationName: "Evening Fair", city: null, region: "ND" }],
      new Date("2026-09-22T01:00:00Z"),
    );
    const workbook = XLSX.read(result.data, { type: "array", cellDates: true });

    expect(result.filename).toBe("adventure-zone-follow-ups-2026-09-21.xlsx");
    expect(workbook.Sheets["Follow-ups"]?.B9.v).toBe("Due today");
  });
});
