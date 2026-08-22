import rawSource from "./data/adventure-zone-attended-calendar-2026.json";

export type AttendanceSourceStatus =
  | "attended"
  | "blacklisted"
  | "cancelled_last_minute";

export type AttendanceSourceYearStatus = {
  year: number;
  status: AttendanceSourceStatus;
};

export type AttendanceSourceRow = {
  sourceRowNumber: number;
  month: string;
  eventName: string;
  location: string;
  statuses: AttendanceSourceYearStatus[];
};

export type AttendanceSourceFixture = {
  sourceFile: "Adventure Zone Attended Calendar.xlsx";
  sheet: "Sheet1";
  range: "A1:N129";
  legend: {
    X: "attended";
    B: "blacklisted";
    C: "cancelled_last_minute";
  };
  rows: AttendanceSourceRow[];
};

export const attendanceSourceFixture = rawSource as AttendanceSourceFixture;

export function attendanceSourceCounts(source: AttendanceSourceFixture = attendanceSourceFixture) {
  const statuses = source.rows.flatMap((row) => row.statuses);
  return {
    rows: source.rows.length,
    statuses: statuses.length,
    attended: statuses.filter((item) => item.status === "attended").length,
    blacklisted: statuses.filter((item) => item.status === "blacklisted").length,
    cancelledLastMinute: statuses.filter((item) => item.status === "cancelled_last_minute").length,
  };
}
