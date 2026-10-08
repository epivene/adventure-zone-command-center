import { useEffect, useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { createActivityAction } from "./adapter";
import { BUSINESS_TIME_ZONE } from "./adapter";
import { latestProfileNote, profileNoteTime, type DatedProfileNote } from "./latest-profile-note";
import { htmlToPlainText } from "./history-summary";

export function ProfileLatestNote({ profileId, contactId, notes, onSaved, readOnly = false }: {
  profileId: string;
  contactId?: string | null;
  notes: DatedProfileNote[];
  onSaved?(): Promise<void> | void;
  readOnly?: boolean;
}) {
  const [optimistic, setOptimistic] = useState<DatedProfileNote | null>(null);
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (optimistic && notes.some(note => note.id === optimistic.id)) setOptimistic(null);
  }, [notes, optimistic]);
  const note = latestProfileNote(optimistic ? [optimistic, ...notes] : notes);
  const timestamp = note ? profileNoteTime(note) : 0;

  async function save() {
    if (readOnly || !body.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await createActivityAction({
        organizationId: profileId, contactId: contactId ?? undefined,
        kind: "note", body: body.trim(), occurredAt: new Date(),
      });
      if (!result.ok) throw new Error(result.error);
      setOptimistic(result.activity);
      setBody(""); setComposing(false); setSaved(true);
      try { await onSaved?.(); }
      catch { setError("Your note was saved, but the rest of the profile could not refresh."); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your note. Your draft is still here.");
    } finally { setBusy(false); }
  }

  return <Card data-testid="profile-latest-note" aria-labelledby="profile-latest-note-title">
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
      <div>
        <CardTitle id="profile-latest-note-title">Latest note</CardTitle>
        {timestamp ? <time className="mt-1 block text-xs text-muted-foreground" dateTime={new Date(timestamp).toISOString()}>
          {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: BUSINESS_TIME_ZONE }).format(new Date(timestamp))}
        </time> : note ? <p className="mt-1 text-xs text-muted-foreground">Historical date not recorded</p> : null}
      </div>
      {!readOnly && !composing ? <Button variant="outline" size="sm" data-testid="add-profile-note" onClick={() => { setComposing(true); setSaved(false); setError(null); }}>Add note</Button> : null}
    </CardHeader>
    <CardContent className="grid gap-4">
      <p data-testid="profile-latest-note-body" className="whitespace-pre-wrap break-words leading-7">
        {note ? htmlToPlainText(note.body ?? "") : "No notes recorded yet."}
      </p>
      {!readOnly && composing ? <div className="grid gap-3">
        <Label htmlFor="profile-front-note">New note</Label>
        <Textarea id="profile-front-note" data-testid="profile-front-note-input" autoFocus disabled={busy} value={body} onChange={event => setBody(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button data-testid="save-profile-front-note" disabled={busy || !body.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save note"}</Button>
          <Button variant="outline" data-testid="cancel-profile-front-note" disabled={busy} onClick={() => { setComposing(false); setBody(""); setError(null); }}>Cancel</Button>
        </div>
      </div> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {saved ? <p role="status" className="text-sm text-muted-foreground">Note saved.</p> : null}
    </CardContent>
  </Card>;
}
