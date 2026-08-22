export type GoogleScopeLabel = {
  id: string;
  name: string;
  rootId: string;
  rootName: string;
};

export type GoogleScopeCalendar = {
  id: string;
  summary: string;
  primary: boolean;
};

export type GoogleSavedScope = {
  labels: GoogleScopeLabel[];
  calendars: GoogleScopeCalendar[];
};

export type GoogleScopeActorKind = "owner" | "office";

export type ReplaceGoogleScopeInput = GoogleSavedScope & {
  connectionId: string;
  actorKind: GoogleScopeActorKind;
  actorId: string;
  now: Date;
};

export interface GoogleScopePersistence {
  get(connectionId: string): Promise<GoogleSavedScope>;
  replace(input: ReplaceGoogleScopeInput): Promise<void>;
}
