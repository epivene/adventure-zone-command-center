export type ProfileCsvRow = {
  eventName: string;
  location: string;
  nextDate: string;
  nextEventStatus: string;
  latestRecordedEventDate: string;
  latestRecordedEventEndDate: string;
  latestRecordedEventSource: string;
  deadline: string;
  status: string;
  recommendedDealModel: string;
  nextAction: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

const headers: Array<[keyof ProfileCsvRow, string]> = [
  ["eventName", "Event name"],
  ["location", "Location"],
  ["nextDate", "Next event date"],
  ["nextEventStatus", "Next event status"],
  ["latestRecordedEventDate", "Latest recorded event date"],
  ["latestRecordedEventEndDate", "Latest recorded event end date"],
  ["latestRecordedEventSource", "Latest recorded date source"],
  ["deadline", "Deadline"],
  ["status", "Status"],
  ["recommendedDealModel", "Recommended deal model"],
  ["nextAction", "Next action"],
  ["contactName", "Contact name"],
  ["contactEmail", "Contact email"],
  ["contactPhone", "Contact phone"],
];

function csvValue(value: string): string {
  const safe = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function createProfileCsv(rows: ProfileCsvRow[]): string {
  return [
    headers.map(([, label]) => csvValue(label)).join(","),
    ...rows.map((row) => headers.map(([key]) => csvValue(row[key])).join(",")),
  ].join("\r\n");
}
