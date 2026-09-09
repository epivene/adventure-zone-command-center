import { apiFetch } from "@/lib/auth-token";

export interface DriveBackupStatus {
  connection: { email: string; status: string } | null;
  scopeReady: boolean;
  reconnectRequired: boolean;
  config: {
    connectionId: string | null;
    rootFolderId: string | null;
    rootWebViewLink: string | null;
    state: string;
  };
  queue: Record<string, number>;
  run: { id: string; mode: string; state: string; counts?: Record<string, number> } | null;
}

export interface DriveBackupPreview {
  profileCount: number;
  followUpPdfCount: number;
  documentCount: number;
  needsFilingCount: number;
  byYear: Record<string, number>;
  byDocumentType: Record<string, number>;
  samplePaths: readonly string[];
  warnings: readonly string[];
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body && typeof body === "object" && typeof body.error === "string"
      ? body.error : `API ${response.status}`;
    throw new Error(code);
  }
  return body as T;
}

function post<T>(path: string, body: object = {}): Promise<T> {
  return apiFetch(path, { method: "POST", body: JSON.stringify(body) }).then(json<T>);
}

export const getDriveBackupStatus = () =>
  apiFetch("/google-drive-backup").then(json<DriveBackupStatus>);
export const createDriveBackupRoot = () =>
  post("/google-drive-backup/root", { confirmation: "CREATE BACKUP FOLDER" });
export const previewDriveBackup = () =>
  post<DriveBackupPreview>("/google-drive-backup/preview");
export const startDriveBackupPilot = (profileLimit: number) =>
  post("/google-drive-backup/pilot", { profileLimit, confirmation: "START PILOT" });
export const startDriveBackupBackfill = () =>
  post("/google-drive-backup/backfill/start", { confirmation: "START BACKFILL" });
export const pauseDriveBackupBackfill = () =>
  post("/google-drive-backup/backfill/pause");
export const resumeDriveBackupBackfill = () =>
  post("/google-drive-backup/backfill/resume");
export const retryDriveBackupFailures = () =>
  post<{ retried: number }>("/google-drive-backup/retry");
