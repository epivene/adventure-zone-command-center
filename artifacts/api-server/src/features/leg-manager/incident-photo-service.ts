export type IncidentAttachmentForView = {
  id: string;
  incidentId: string;
  imageStatus: string;
  objectKey: string | null;
  mimeType: string | null;
  [key: string]: unknown;
};

type SignedUrlStorage = {
  getSignedUrl(key: string): Promise<string>;
};

export async function attachIncidentPhotoUrls<T extends { id: string }, A extends IncidentAttachmentForView>(
  incidents: T[],
  attachments: A[],
  storage: SignedUrlStorage,
) {
  const enriched = await Promise.all(
    attachments.map(async (attachment) => {
      let imageUrl: string | null = null;
      if (attachment.imageStatus === "image_uploaded" && attachment.objectKey) {
        try {
          imageUrl = await storage.getSignedUrl(attachment.objectKey);
        } catch {
          imageUrl = null;
        }
      }
      return { ...attachment, imageUrl };
    }),
  );
  const byIncident = new Map<string, typeof enriched>();
  for (const attachment of enriched) {
    const list = byIncident.get(attachment.incidentId) ?? [];
    list.push(attachment);
    byIncident.set(attachment.incidentId, list);
  }
  return incidents.map((incident) => ({
    ...incident,
    attachments: byIncident.get(incident.id) ?? [],
  }));
}
