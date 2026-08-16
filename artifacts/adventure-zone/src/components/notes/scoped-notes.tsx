import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Could not save note. Please try again.";
}

function fmt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Denver",
  }).format(new Date(value));
}

export function ScopedNotes({
  title,
  notes,
  readOnly = false,
  emptyText = "No notes yet.",
  onCreate,
  onUpdate,
  onDelete,
  footer,
}: {
  title: string;
  notes: ScopedNoteView[];
  readOnly?: boolean;
  emptyText?: string;
  onCreate?: (body: string) => Promise<ScopedNoteView>;
  onUpdate?: (id: string, body: string) => Promise<ScopedNoteView>;
  onDelete?: (id: string) => Promise<void>;
  footer?: ReactNode;
}) {
  const [items, setItems] = useState(notes);
  const [addOpen, setAddOpen] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setItems(notes), [notes]);

  const sorted = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [items],
  );

  async function create() {
    if (!onCreate || !newBody.trim()) return;
    setBusyId("new");
    setError(null);
    try {
      const note = await onCreate(newBody.trim());
      setItems((current) => [note, ...current]);
      setNewBody("");
      setAddOpen(false);
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusyId(null);
    }
  }

  async function update(id: string) {
    if (!onUpdate || !editBody.trim()) return;
    setBusyId(id);
    setError(null);
    try {
      const note = await onUpdate(id, editBody.trim());
      setItems((current) => current.map((item) => item.id === id ? note : item));
      setEditingId(null);
      setEditBody("");
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!onDelete) return;
    setBusyId(id);
    setError(null);
    try {
      await onDelete(id);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold">{title}</h3>
        {!readOnly && onCreate ? (
          <button className="button-secondary" type="button" onClick={() => setAddOpen((value) => !value)}>
            {addOpen ? "Cancel note" : "Add note"}
          </button>
        ) : null}
      </div>

      {addOpen && !readOnly ? (
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            Note
            <textarea className="min-h-24 rounded-md border border-slate-300 bg-white px-3 py-2 font-normal" maxLength={4000} value={newBody} onChange={(event) => setNewBody(event.target.value)} />
          </label>
          <button className="button-primary w-fit" disabled={busyId === "new" || !newBody.trim()} type="button" onClick={() => void create()}>
            {busyId === "new" ? "Saving…" : "Save note"}
          </button>
        </div>
      ) : null}

      {error ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{error}</p> : null}

      {!sorted.length ? <p className="text-sm text-slate-500">{emptyText}</p> : (
        <ul className="grid gap-2">
          {sorted.map((note) => {
            const changed = note.updatedAt !== note.createdAt;
            const editing = editingId === note.id;
            return (
              <li className="rounded-lg border border-slate-200 bg-white p-3" key={note.id}>
                {editing ? (
                  <div className="grid gap-2">
                    <label className="grid gap-1 text-sm font-semibold text-slate-700">
                      Edit note
                      <textarea className="min-h-24 rounded-md border border-slate-300 px-3 py-2 font-normal" maxLength={4000} value={editBody} onChange={(event) => setEditBody(event.target.value)} />
                    </label>
                    <div className="flex gap-2">
                      <button className="button-primary" disabled={busyId === note.id || !editBody.trim()} type="button" onClick={() => void update(note.id)}>Save</button>
                      <button className="button-secondary" disabled={busyId === note.id} type="button" onClick={() => { setEditingId(null); setEditBody(""); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p>
                    <p className="mt-2 text-xs text-slate-500">Created {fmt(note.createdAt)}{changed ? ` · Updated ${fmt(note.updatedAt)}` : ""}</p>
                    {!readOnly ? (
                      <div className="mt-2 flex flex-wrap gap-3">
                        {onUpdate ? <button className="text-sm font-semibold text-slate-700 hover:underline" type="button" onClick={() => { setEditingId(note.id); setEditBody(note.body); }}>Edit</button> : null}
                        {onDelete ? <button className="text-sm font-semibold text-rose-700 hover:underline" disabled={busyId === note.id} type="button" onClick={() => void remove(note.id)}>{busyId === note.id ? "Deleting…" : "Delete"}</button> : null}
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {footer ? <div className="text-sm">{footer}</div> : null}
    </div>
  );
}
