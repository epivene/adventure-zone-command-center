import { useRef, useState } from "react";
import { workRequest, type WorkActivity } from "./client";
import { previewRelease, releaseBatch } from "./bulk-release";

export function BulkReleaseWork({ query, canStart, onBusy, onChanged }: {
  query: string; canStart: () => boolean; onBusy: (busy: boolean) => void; onChanged: () => void;
}) {
  const [preview, setPreview] = useState<{ query: string; cards: WorkActivity[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const guard = useRef(false);
  const stop = useRef(false);
  function lock(value: boolean) { guard.current = value; setBusy(value); onBusy(value); }
  async function prepare() {
    if (guard.current) return;
    if (!canStart()) { setError("Save or cancel open card edits first."); return; }
    lock(true); setError(""); setMessage("Loading all matching pages…"); setPreview(null);
    try {
      const cards = await previewRelease(query, workRequest);
      setPreview({ query, cards });
      setMessage(cards.length ? "" : "No assigned unfinished cards match these filters.");
    } catch (e) { setError((e as Error).message); setMessage(""); }
    finally { lock(false); }
  }
  async function release() {
    if (guard.current || !preview || preview.query !== query) return;
    if (!canStart()) { setError("Save or cancel open card edits first."); return; }
    const cards = preview.cards;
    lock(true); stop.current = false; setPreview(null); setError("");
    let released = 0, skipped = 0;
    try {
      const result = await releaseBatch(cards, workRequest, (r, s) => {
        released = r; skipped = s;
        setMessage(`Released ${r} of ${cards.length}; ${s} changed cards skipped. Keep this page open.`);
      }, () => stop.current);
      setMessage(`Released ${result.released} cards. ${result.skipped.length} changed cards skipped.${stop.current ? " Stopped; preview again for remaining work." : ""}`);
    } catch (e) {
      setError(`Stopped after ${released} confirmed releases and ${skipped} skipped cards. ${(e as Error).message} Refresh and preview again to check remaining work; the last request may have succeeded.`);
    } finally { lock(false); onChanged(); }
  }
  const current = preview?.query === query ? preview : null;
  return <div className="grid gap-2 rounded-xl border p-4">
    <h3 className="font-semibold">Release unfinished work in bulk</h3>
    <p className="text-sm">Use the filters below to choose work, or leave them on All to include every page. Only unfinished cards assigned to Com connections are included. Progress, status, dates and links stay on each card.</p>
    <button className="button-secondary justify-self-start" disabled={busy} onClick={() => void prepare()}>Preview bulk release</button>
    {current && current.cards.length > 0 ? <div className="grid gap-2">
      <p>Release {current.cards.length} cards to Unassigned so they can be claimed again?</p>
      <details><summary>Review included cards</summary>
        <ul className="max-h-64 overflow-auto text-sm">{current.cards.map(a => <li key={a.id}>{a.title} — {a.eventYear}</li>)}</ul>
      </details>
      <p className="text-sm">This hands off work from its current connections. Cards edited after this preview will be skipped.</p>
      <div className="flex flex-wrap gap-2">
        <button className="button-primary" disabled={busy} onClick={() => void release()}>Release {current.cards.length} cards</button>
        <button className="button-secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
      </div>
    </div> : null}
    {busy ? <button className="button-secondary justify-self-start" onClick={() => { stop.current = true; }}>Stop after current card</button> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </div>;
}
