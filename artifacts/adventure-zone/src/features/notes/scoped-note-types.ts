export type ScopedNoteView = {
  id: string;
  body: string;
  ownerKind?: "organization_location" | "event_family";
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
};
