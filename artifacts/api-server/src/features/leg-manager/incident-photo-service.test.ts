import { describe, expect, it, vi } from "vitest";
import { attachIncidentPhotoUrls } from "./incident-photo-service";

describe("incident photo service", () => {
  it("adds viewable URLs only for uploaded incident photos", async () => {
    const getSignedUrl = vi.fn(async (key: string) => `https://example.test/${key}`);
    const incidents = [{ id: "incident-1", type: "injury" }];
    const attachments = [
      { id: "photo-1", incidentId: "incident-1", imageStatus: "image_uploaded", objectKey: "incidents/leg-a/incident-1/photo-1", mimeType: "image/jpeg" },
      { id: "photo-2", incidentId: "incident-1", imageStatus: "pending", objectKey: null, mimeType: "image/jpeg" },
    ];

    const result = await attachIncidentPhotoUrls(incidents, attachments, { getSignedUrl });

    expect(result[0].attachments).toEqual([
      expect.objectContaining({ id: "photo-1", imageUrl: "https://example.test/incidents/leg-a/incident-1/photo-1" }),
      expect.objectContaining({ id: "photo-2", imageUrl: null }),
    ]);
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });
});
