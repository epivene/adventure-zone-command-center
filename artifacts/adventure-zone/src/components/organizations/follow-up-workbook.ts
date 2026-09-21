import * as XLSX from "xlsx";

export type FollowUpWorkbook = {
  data: Uint8Array;
  filename: string;
};

export function createFollowUpWorkbook(
  csv: ArrayBuffer | Uint8Array,
  asOf: Date,
): FollowUpWorkbook {
  const csvBytes = csv instanceof Uint8Array ? csv : new Uint8Array(csv);
  const sourceWorkbook = XLSX.read(new TextDecoder().decode(csvBytes), {
    type: "string",
  });
  const sourceSheet = sourceWorkbook.Sheets[sourceWorkbook.SheetNames[0] ?? ""];
  if (!sourceSheet) throw new Error("The follow-up export was empty.");

  const sourceRows = XLSX.utils.sheet_to_json<Record<string, string>>(
    sourceSheet,
    { defval: "" },
  );
  const asOfKey = dateKey(asOf);
  const throughDate = new Date(`${asOfKey}T12:00:00Z`);
  throughDate.setUTCDate(throughDate.getUTCDate() + 7);
  const throughKey = dateKey(throughDate);
  const rows = sourceRows
    .map((row) => {
      const action = splitNextAction(row["Next action"] ?? "");
      const status = !action.dueDate
        ? "Unscheduled"
        : action.dueDate < asOfKey
          ? "Overdue"
          : action.dueDate === asOfKey
            ? "Due today"
            : "Upcoming";
      return {
        dueDate: action.dueDate,
        status,
        type: action.type,
        name: row["Event name"] ?? "",
        location: row.Location ?? "",
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

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function splitNextAction(value: string): {
  type: string;
  dueDate: string;
} {
  const match = value.match(/^(.*) — (\d{4}-\d{2}-\d{2})$/);
  return match
    ? { type: match[1] ?? "", dueDate: match[2] ?? "" }
    : { type: value, dueDate: "" };
}
