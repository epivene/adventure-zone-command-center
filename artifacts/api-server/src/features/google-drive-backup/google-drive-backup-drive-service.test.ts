import { describe, expect, it, vi } from "vitest";
import type { GoogleDriveBackupClient, GoogleDriveBackupFile } from "../google-workspace/google-api-types";
import { GoogleDriveBackupDriveService } from "./google-drive-backup-drive-service";

const folder = (id: string, name: string, parent?: string): GoogleDriveBackupFile => ({
  id, name, mimeType: "application/vnd.google-apps.folder",
  parents: parent ? [parent] : [], webViewLink: null, md5Checksum: null,
});

describe("GoogleDriveBackupDriveService", () => {
  it("creates an unmapped file once and skips an unchanged repeat", async () => {
    const files = new Map<string, GoogleDriveBackupFile>([["root", folder("root", "Backup")]]);
    const folders = new Map<string, any>();
    let mapping: any = null;
    let next = 0;
    const client: GoogleDriveBackupClient = {
      getFile: vi.fn(async (id) => files.get(id)!),
      findChild: vi.fn(async () => null),
      createFolder: vi.fn(async (parentId, name) => {
        const value = folder(`folder-${++next}`, name, parentId); files.set(value.id, value); return value;
      }),
      createFile: vi.fn(async ({ parentId, name, mimeType }) => {
        const value = { id: "file-1", name, mimeType, parents: [parentId], webViewLink: "link", md5Checksum: null };
        files.set(value.id, value); return value;
      }),
      updateFile: vi.fn(async () => { throw new Error("unexpected update"); }),
    };
    const repository = {
      getFolder: vi.fn(async (path: string) => folders.get(path) ?? null),
      upsertFolder: vi.fn(async (value: any) => { folders.set(value.logicalPath, value); }),
      getMapping: vi.fn(async () => mapping),
      upsertMapping: vi.fn(async (value: any) => { mapping = value; }),
    };
    const service = new GoogleDriveBackupDriveService({ client, repository, rootFolderId: "root" });
    const input = {
      entityKind: "profile_summary" as const, entityId: "entity", sourceVersion: "1",
      path: { directories: ["Profiles", "Fair--11111111"], fileName: "Profile Summary.pdf", logicalPath: "Profiles/Fair--11111111/Profile Summary.pdf" },
      mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]), now: new Date("2026-09-09T00:00:00Z"),
    };
    await expect(service.exportFile(input)).resolves.toMatchObject({ outcome: "created", fileId: "file-1" });
    await expect(service.exportFile(input)).resolves.toMatchObject({ outcome: "unchanged", fileId: "file-1" });
    expect(client.createFile).toHaveBeenCalledTimes(1);
    expect(client.updateFile).not.toHaveBeenCalled();
  });
});
