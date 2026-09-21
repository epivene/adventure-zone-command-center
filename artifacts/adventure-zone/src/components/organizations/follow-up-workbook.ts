import * as XLSX from "xlsx";

import { businessDateKey } from "@/lib/business-date";

export type FollowUpWorkbook = {
  data: Uint8Array;
  filename: string;
};

export type FollowUpWorkbookRow = {
  id: string;
  kind: string;
  dueAt: string;
  organizationName: string;
  city: string | null;
  region: string | null;
};

export function createFollowUpWorkbook(
  followUps: FollowUpWorkbookRow[],
  asOf: Date,
): FollowUpWorkbook {
  const asOfKey = businessDateKey(asOf);
  const throughDate = new Date(`${asOfKey}T12:00:00Z`);
  throughDate.setUTCDate(throughDate.getUTCDate() + 7);
  const throughKey = throughDate.toISOString().slice(0, 10);
  const rows = followUps
    .map((followUp) => {
      const dueDate = businessDateKey(new Date(followUp.dueAt));
      const status = dueDate < asOfKey
          ? "Overdue"
          : dueDate === asOfKey
            ? "Due today"
            : "Upcoming";
      return {
        dueDate,
        status,
        type: followUp.kind,
        name: followUp.organizationName,
        location: [followUp.city, followUp.region].filter(Boolean).join(", "),
      };
    })
    .sort(
      (left, right) =>
        (left.dueDate || "9999-12-31").localeCompare(
          right.dueDate || "9999-12-31",
        ) || left.name.localeCompare(right.name),
    );

  const overdue = rows.filter((row) => row.status === "Overdue").length;
  const dueThrough = rows.filter(
    (row) =>
      Boolean(row.dueDate) &&
      row.dueDate >= asOfKey &&
      row.dueDate <= throughKey,
  ).length;
  const sheetRows: unknown[][] = [
    [],
    ["Adventure Zone follow-ups"],
    ["As of", dateAtNoon(asOfKey)],
    [],
    [
      "Total follow-ups",
      rows.length,
      "Overdue",
      overdue,
      `Due through ${formatShortDate(throughDate)}`,
      dueThrough,
    ],
    [],
    [],
    ["Due date", "Status", "Follow-up type", "Event or profile", "Location"],
    ...rows.map((row) => [
      row.dueDate ? dateAtNoon(row.dueDate) : "",
      row.status,
      row.type,
      row.name,
      row.location,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sheetRows, { cellDates: true });
  sheet["!cols"] = [
    { wch: 15 },
    { wch: 14 },
    { wch: 38 },
    { wch: 52 },
    { wch: 24 },
  ];
  sheet["!autofilter"] = { ref: `A8:E${Math.max(8, rows.length + 8)}` };
  for (const address of ["B3", ...rows.map((_, index) => `A${index + 9}`)]) {
    if (sheet[address]?.t === "d") sheet[address].z = "mmm d, yyyy";
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Follow-ups");
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return {
    data: new Uint8Array(output),
    filename: `adventure-zone-follow-ups-${asOfKey}.xlsx`,
  };
}

function dateAtNoon(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function formatShortDate(value: Date): string {
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
