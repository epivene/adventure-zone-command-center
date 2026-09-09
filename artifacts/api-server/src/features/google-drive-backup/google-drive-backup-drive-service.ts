import { createHash } from "node:crypto";

import type {
  GoogleDriveBackupClient,
  GoogleDriveBackupFile,
} from "../google-workspace/google-api-types";
import type { ResolvedBackupPath } from "./google-drive-backup-types";
import type {
  BackupEntityKind,
  BackupMapping,
  PostgresGoogleDriveBackupRepository,
} from "./google-drive-backup-repository";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export interface BackupFileExport {
  entityKind: BackupEntityKind;
  entityId: string;
  sourceVersion: string;
  path: ResolvedBackupPath;
  mimeType: string;
  bytes: Uint8Array;
  now: Date;
}

export interface BackupFileExportResult {
  outcome: "created" | "updated" | "unchanged";
  fileId: string;
  webViewLink: string | null;
  sha256Hex: string;
}

export class DriveContainmentError extends Error {
  readonly code = "GOOGLE_DRIVE_BACKUP_CONTAINMENT_FAILED";
}

type MappingStore = Pick<PostgresGoogleDriveBackupRepository,
  "getMapping" | "getFolder" | "upsertFolder" | "upsertMapping">;

function isChild(file: GoogleDriveBackupFile, parentId: string): boolean {
  return file.parents.includes(parentId);
}

export class GoogleDriveBackupDriveService {
  constructor(private readonly options: {
    client: GoogleDriveBackupClient;
    repository: MappingStore;
    rootFolderId: string;
  }) {
    if (!options.rootFolderId.trim()) {
      throw new Error("GOOGLE_DRIVE_BACKUP_ROOT_REQUIRED");
    }
  }

  async ensureRoot(): Promise<GoogleDriveBackupFile> {
    const root = await this.options.client.getFile(this.options.rootFolderId);
    if (root.mimeType !== FOLDER_MIME_TYPE) {
      throw new DriveContainmentError("Configured backup root is not a folder");
    }
    return root;
  }

  private async ensureDirectories(
    directories: readonly string[],
    now: Date,
  ): Promise<string> {
    await this.ensureRoot();
    let parentId = this.options.rootFolderId;
    let parentLogicalPath: string | null = null;
    const logicalSegments: string[] = [];

    for (const name of directories) {
      logicalSegments.push(name);
      const logicalPath = logicalSegments.join("/");
      const mapped = await this.options.repository.getFolder(logicalPath);
      let folder: GoogleDriveBackupFile;
      if (mapped) {
        if (
          mapped.parentDriveFolderId !== parentId ||
          mapped.parentLogicalPath !== parentLogicalPath
        ) {
          throw new DriveContainmentError(
            `Folder mapping escaped backup root: ${logicalPath}`,
          );
        }
        folder = await this.options.client.getFile(mapped.driveFolderId);
        if (folder.mimeType !== FOLDER_MIME_TYPE || !isChild(folder, parentId)) {
          throw new DriveContainmentError(
            `Drive folder escaped backup root: ${logicalPath}`,
          );
        }
      } else {
        folder =
          await this.options.client.findChild(parentId, name, FOLDER_MIME_TYPE) ??
          await this.options.client.createFolder(parentId, name);
        if (folder.mimeType !== FOLDER_MIME_TYPE || !isChild(folder, parentId)) {
          throw new DriveContainmentError(
            `Created folder is outside backup root: ${logicalPath}`,
          );
        }
      }
      await this.options.repository.upsertFolder({
        logicalPath,
        driveFolderId: folder.id,
        parentLogicalPath,
        parentDriveFolderId: parentId,
      }, now);
      parentId = folder.id;
      parentLogicalPath = logicalPath;
    }
    return parentId;
  }

  async exportFile(input: BackupFileExport): Promise<BackupFileExportResult> {
    const sha256Hex = createHash("sha256").update(input.bytes).digest("hex");
    const parentId = await this.ensureDirectories(input.path.directories, input.now);
    const mapping = await this.options.repository.getMapping(
      input.entityKind,
      input.entityId,
    );

    if (mapping && mapping.sha256Hex === sha256Hex &&
        mapping.logicalPath === input.path.logicalPath) {
      const file = await this.options.client.getFile(mapping.driveFileId);
      if (!isChild(file, parentId)) {
        throw new DriveContainmentError("Unchanged mapped file escaped backup root");
      }
      return {
        outcome: "unchanged",
        fileId: file.id,
        webViewLink: file.webViewLink,
        sha256Hex,
      };
    }

    let file: GoogleDriveBackupFile;
    let outcome: BackupFileExportResult["outcome"];
    if (mapping) {
      const current = await this.options.client.getFile(mapping.driveFileId);
      if (!isChild(current, mapping.driveParentId)) {
        throw new DriveContainmentError("Mapped file escaped its verified parent");
      }
      file = await this.options.client.updateFile({
        fileId: mapping.driveFileId,
        name: input.path.fileName,
        mimeType: input.mimeType,
        bytes: input.bytes,
        ...(mapping.driveParentId === parentId ? {} : {
          currentParentId: mapping.driveParentId,
          parentId,
        }),
      });
      if (file.id !== mapping.driveFileId || !isChild(file, parentId)) {
        throw new DriveContainmentError("Updated file escaped backup root");
      }
      outcome = "updated";
    } else {
      file = await this.options.client.createFile({
        parentId,
        name: input.path.fileName,
        mimeType: input.mimeType,
        bytes: input.bytes,
      });
      if (!isChild(file, parentId)) {
        throw new DriveContainmentError("Created file escaped backup root");
      }
      outcome = "created";
    }

    const mappingWrite: BackupMapping = {
      entityKind: input.entityKind,
      entityId: input.entityId,
      driveFileId: file.id,
      driveParentId: parentId,
      logicalPath: input.path.logicalPath,
      sha256Hex,
      sourceVersion: input.sourceVersion,
    };
    await this.options.repository.upsertMapping(mappingWrite, input.now);
    return {
      outcome,
      fileId: file.id,
      webViewLink: file.webViewLink,
      sha256Hex,
    };
  }
}
