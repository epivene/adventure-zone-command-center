import type { GoogleDriveFile, GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import type { BusinessDocumentCandidate } from "./business-document-ingestion";

export const GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const skippedName = /^(?:\.|~\$)|^(?:tmp|temp|temporary|system)(?:$|[ _-])/i;

export type DriveDocumentInventoryItem = GoogleDriveFile & { rootFolderId: string };

export class GoogleDriveDocumentSource {
  constructor(private readonly client: Pick<GoogleWorkspaceReadClient, "listDriveFiles" | "downloadDriveFile">) {}

  async inventory(folderIds: string[]): Promise<DriveDocumentInventoryItem[]> {
    if (!this.client.listDriveFiles) throw new Error("GOOGLE_DRIVE_LIST_UNAVAILABLE");
    const roots = [...new Set(folderIds.map((id) => id.trim()).filter(Boolean))];
    if (!roots.length || roots.length > 25) throw new Error("GOOGLE_DRIVE_APPROVED_ROOTS_INVALID");
    const queue = roots.map((folderId) => ({ folderId, rootFolderId: folderId }));
    const visited = new Set<string>();
    const files: DriveDocumentInventoryItem[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current.folderId)) continue;
      visited.add(current.folderId);
      let pageToken: string | null = null;
      do {
        const page = await this.client.listDriveFiles(current.folderId, pageToken);
        for (const file of page.files) {
          if (skippedName.test(file.name)) continue;
          if (file.mimeType === GOOGLE_DRIVE_FOLDER_MIME) queue.push({ folderId: file.id, rootFolderId: current.rootFolderId });
          else files.push({ ...file, rootFolderId: current.rootFolderId });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    return files;
  }

  async candidate(file: DriveDocumentInventoryItem, accountKey: string): Promise<BusinessDocumentCandidate> {
    if (!this.client.downloadDriveFile) throw new Error("GOOGLE_DRIVE_DOWNLOAD_UNAVAILABLE");
    const bytes = await this.client.downloadDriveFile(file.id, file.mimeType);
    const extension = file.mimeType === "application/vnd.google-apps.document" || file.mimeType === "application/vnd.google-apps.presentation" ? ".pdf"
      : file.mimeType === "application/vnd.google-apps.spreadsheet" ? ".xlsx" : "";
    return {
      bytes,
      filename: extension && !file.name.toLowerCase().endsWith(extension) ? `${file.name}${extension}` : file.name,
      mimeType: file.mimeType === "application/vnd.google-apps.document" || file.mimeType === "application/vnd.google-apps.presentation" ? "application/pdf"
        : file.mimeType === "application/vnd.google-apps.spreadsheet" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : file.mimeType,
      subject: file.name,
      bodyText: "",
      source: { sourceKind: "drive", sourceAccountKey: accountKey, externalId: file.id, originalUrl: file.webViewLink, metadata: { modifiedTime: file.modifiedTime, size: file.size, rootFolderId: file.rootFolderId } },
      evidence: { approvedThreadProfileId: null, exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] },
      actor: "google_drive_import",
    };
  }
}
