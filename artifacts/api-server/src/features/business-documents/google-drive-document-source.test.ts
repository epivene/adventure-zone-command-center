import { describe, expect, it, vi } from "vitest";
import { GoogleDriveDocumentSource, GOOGLE_DRIVE_FOLDER_MIME } from "./google-drive-document-source";

describe("GoogleDriveDocumentSource", () => {
  it("never lists outside approved roots and discovered descendants", async () => {
    const listDriveFiles = vi.fn(async (parentId: string) => ({
      files: parentId === "contracts" ? [
        { id: "child", name: "Signed", mimeType: GOOGLE_DRIVE_FOLDER_MIME, modifiedTime: null, size: null, parents: [parentId], webViewLink: null },
        { id: "f1", name: "Contract.pdf", mimeType: "application/pdf", modifiedTime: null, size: 10, parents: [parentId], webViewLink: null },
      ] : [{ id: "f2", name: "COI.pdf", mimeType: "application/pdf", modifiedTime: null, size: 10, parents: [parentId], webViewLink: null }],
      nextPageToken: null,
    }));
    const source = new GoogleDriveDocumentSource({ listDriveFiles, downloadDriveFile: vi.fn() });
    await expect(source.inventory(["contracts"])).resolves.toHaveLength(2);
    expect(listDriveFiles).toHaveBeenCalledWith("contracts", null);
    expect(listDriveFiles).toHaveBeenCalledWith("child", null);
    expect(listDriveFiles).not.toHaveBeenCalledWith("root", expect.anything());
  });

  it("does not download during inventory", async () => {
    const downloadDriveFile = vi.fn();
    const source = new GoogleDriveDocumentSource({ listDriveFiles: vi.fn(async () => ({ files: [], nextPageToken: null })), downloadDriveFile });
    await source.inventory(["contracts"]);
    expect(downloadDriveFile).not.toHaveBeenCalled();
  });
});
