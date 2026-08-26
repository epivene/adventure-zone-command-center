import { useEffect, useState } from "react";
import type {
  CommunicationBlock,
  CommunicationBlockEvent,
} from "@/features/lead-intake/lead-intake-client";

export function LeadCommunicationBlocks({ list, create, remove, history, onMutation }: { list: () => Promise<CommunicationBlock[]>; create: (body: unknown) => Promise<unknown>; remove: (id: string, reason: string) => Promise<unknown>; history?: (id: string) => Promise<CommunicationBlockEvent[]>; onMutation?: () => void }) {
  const [blocks, setBlocks] = useState<CommunicationBlock[]>([]);
  const [targetType, setTargetType] = useState("recipient_email");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [removalReasons, setRemovalReasons] = useState<Record<string, string>>({});
  const [historyByBlock, setHistoryByBlock] = useState<Record<string, CommunicationBlockEvent[]>>({});
  const [historyPending, setHistoryPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const reload = async () => { try { setBlocks(await list()); } catch { setError("Could not load communication blocks."); } };
  useEffect(() => { void reload(); }, []);
  async function add() {
    const body: Record<string, string> = { targetType, reason: reason.trim() };
    if (targetType === "recipient_email") body.normalizedEmail = target.trim();
    if (targetType === "organization") body.organizationId = target.trim();
    if (targetType === "contact") body.contactId = target.trim();
    if (targetType === "lead_import_row") body.rowId = target.trim();
    try { setPending(true); setError(""); await create(body); onMutation?.(); setTarget(""); setReason(""); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add block."); } finally { setPending(false); }
  }
  async function removeBlock(id: string) {
    const removalReason = removalReasons[id]?.trim() ?? "";
    if (!removalReason) return;
    try { setPending(true); setError(""); await remove(id, removalReason); onMutation?.(); setRemovalReasons((values) => ({ ...values, [id]: "" })); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove block."); }
    finally { setPending(false); }
  }
  async function loadHistory(id: string) {
    if (!history) return;
    try {
      setHistoryPending(id);
      setError("");
      const events = await history(id);
      setHistoryByBlock((values) => ({ ...values, [id]: events }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load communication block history.");
    } finally {
      setHistoryPending(null);
    }
  }
  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><p className="text-sm font-bold uppercase tracking-wide text-orange-700">DO NOT SEND controls</p><p className="text-sm text-slate-600">Use only a stable profile/contact/row ID or a complete normalized email address. A global internal-preview block has no target and stops every internal preview.</p></div>
    <div className="grid gap-2 sm:grid-cols-3"><select aria-label="Block target type" value={targetType} onChange={(event) => { setTargetType(event.target.value); setTarget(""); }}><option value="recipient_email">Verified recipient email</option><option value="organization">Profile ID</option><option value="contact">Contact ID</option><option value="lead_import_row">Source row ID</option><option value="internal_preview">Global internal preview (no target)</option></select>{targetType === "internal_preview" ? null : <input aria-label="Stable block target" value={target} onChange={(event) => setTarget(event.target.value)} />}<input aria-label="Block reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
    <button className="button-secondary w-fit" disabled={pending || (targetType !== "internal_preview" && !target.trim()) || !reason.trim()} onClick={() => void add()} type="button">Add DO NOT SEND block</button>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    <ul className="grid gap-2">{blocks.map((block) => {
      const targetLabel = block.targetType === "internal_preview"
        ? "Global internal preview"
        : `${block.targetType}: ${block.normalizedEmail ?? block.organizationId ?? block.contactId ?? block.rowId ?? "Unknown target"}`;
      return <li key={block.id} className="grid gap-2 rounded-lg bg-slate-50 p-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
          <span>{targetLabel} — {block.active ? "active" : "removed"}</span>
          {block.active ? <><input aria-label={`Removal reason for ${targetLabel}`} value={removalReasons[block.id] ?? ""} onChange={(event) => setRemovalReasons((values) => ({ ...values, [block.id]: event.target.value }))} /><button className="button-secondary" disabled={pending || !removalReasons[block.id]?.trim()} onClick={() => void removeBlock(block.id)} type="button">Remove</button></> : null}
          {history ? <button className="button-secondary" disabled={historyPending === block.id} onClick={() => void loadHistory(block.id)} type="button">{historyPending === block.id ? "Loading history…" : `View history for ${targetLabel}`}</button> : null}
        </div>
        {historyByBlock[block.id] ? <ul aria-label={`History for ${targetLabel}`} className="grid gap-1 border-l-2 border-slate-200 pl-3 text-sm text-slate-700">{historyByBlock[block.id].map((event) => <li key={event.id}>{event.action} by {event.actorId} · {new Date(event.createdAt).toLocaleString()} — {event.reason}</li>)}</ul> : null}
      </li>;
    })}</ul>
  </section>;
}
