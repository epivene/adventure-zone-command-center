export type ProfileArchiveState = {
  id: string;
  archivedAt: string | null;
};

export type ArchivedProfileSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  archivedAt: string;
};
