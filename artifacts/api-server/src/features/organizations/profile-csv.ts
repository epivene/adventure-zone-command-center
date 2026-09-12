export type ProfileCsvRow = {
  eventName: string; location: string; nextDate: string; deadline: string; status: string;
  recommendedDealModel: string; nextAction: string; contactName: string; contactEmail: string; contactPhone: string;
};

const headers: Array<[keyof ProfileCsvRow, string]> = [
  ["eventName", "Event name"], ["location", "Location"], ["nextDate", "Next date"],
  ["deadline", "Deadline"], ["status", "Status"], ["recommendedDealModel", "Recommended deal model"],
  ["nextAction", "Next action"], ["contactName", "Contact name"], ["contactEmail", "Contact email"],
  ["contactPhone", "Contact phone"],
];

function csvValue(value: string): string {
  const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function createProfileCsv(rows: ProfileCsvRow[]): string {
  return [headers.map(([, label]) => csvValue(label)).join(","), ...rows.map((row) =>
    headers.map(([key]) => csvValue(row[key])).join(","),
  )].join("\r\n");
}
