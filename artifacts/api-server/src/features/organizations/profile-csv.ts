export type ProfileCsvRow = {
  name: string;
  location: string;
  nextDate: string | Date | null;
  deadline: string | Date | null;
  status: string;
  recommendedDealModel: string;
  nextAction: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

function csvValue(value: unknown) {
  const text =
    value == null
      ? ""
      : value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function createProfileCsv(rows: ProfileCsvRow[]) {
  const header = [
    "Event name",
    "Location",
    "Next date",
    "Deadline",
    "Status",
    "Recommended deal model",
    "Next action",
    "Contact name",
    "Contact email",
    "Contact phone",
  ];
  const body = rows.map((row) => [
    row.name,
    row.location,
    row.nextDate,
    row.deadline,
    row.status,
    row.recommendedDealModel,
    row.nextAction,
    row.contactName,
    row.contactEmail,
    row.contactPhone,
  ]);
  return [header, ...body]
    .map((row) => row.map(csvValue).join(","))
    .join("\r\n");
}
