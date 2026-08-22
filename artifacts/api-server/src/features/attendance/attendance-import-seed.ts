import type { db as database } from "@/db/client";
import { ensureBusinessSourceSeed } from "@/features/business-sources/business-source-seed";
import { AttendanceImportRepository } from "./attendance-import-repository";
import { attendanceSourceFixture } from "./attendance-source-fixture";
import {
  chooseAttendanceMatch,
  findPlausibleAttendanceCandidates,
  normalizeAttendanceText,
} from "./attendance-matcher";

type Database = typeof database;

export async function ensureAttendanceImportSeed(database: Database): Promise<void> {
  await ensureBusinessSourceSeed(database);
  const repository = new AttendanceImportRepository(database);
  const sourceDocumentId = await repository.sourceDocumentId(
    attendanceSourceFixture.sourceFile,
  );
  if (!sourceDocumentId) throw new Error("ATTENDANCE_SOURCE_DOCUMENT_MISSING");

  const allCandidates = await repository.listActiveProfileLocationCandidates();

  for (const sourceRow of attendanceSourceFixture.rows) {
    const row = await repository.seedRow(
      sourceDocumentId,
      sourceRow,
      normalizeAttendanceText(sourceRow.eventName),
      normalizeAttendanceText(sourceRow.location),
    );
    if (!row) throw new Error(`ATTENDANCE_IMPORT_ROW_MISSING:${sourceRow.sourceRowNumber}`);

    for (const status of sourceRow.statuses) {
      await repository.seedYearStatus(row.id, status.year, status.status);
    }

    if (row.matchState === "approved" || row.matchState === "rejected") continue;

    const plausible = findPlausibleAttendanceCandidates(
      sourceRow.eventName,
      allCandidates,
    );
    const suggestion = chooseAttendanceMatch(
      {
        importRowId: row.id,
        eventName: sourceRow.eventName,
        location: sourceRow.location,
      },
      plausible,
    );
    await repository.updateMatch(suggestion);
  }
}
