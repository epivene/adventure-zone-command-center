import { useEffect, useState } from "react";
import type { CommunicationBlock } from "@/features/lead-intake/lead-intake-client";

export function LeadCommunicationBlocks({ list, create, remove, onMutation }: { list: () => Promise<CommunicationBlock[]>; create: (body: unknown) => Promise<unknown>; remove: (id: string, reason: string) => Promise<unknown>; onMutation?: () => void }) {
  const [blocks, setBlocks] = useState<CommunicationBlock[]>([]);
  const [targetType, setTargetType] = useState("recipient_email");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const reload = async () => { try { setBlocks(await list()); } catch { setError("Could not load communication blocks."); } };
  useEffect(() => { void reload(); }, []);
  async function add() {
    const body: Record<string, string> = { targetType, reason };
    if (targetType === "recipient_email") body.normalizedEmail = target;
    if (targetType === "organization") body.organizationId = target;
    if (targetType === "contact") body.contactId = target;
    if (targetType === "lead_import_row") body.rowId = target;
    try { setPending(true); setError(""); await create(body); setTarget(""); setReason(""); await reload(); onMutation?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add block."); } finally { setPending(false); }
  }
  async function removeBlock(id: string) {
    try { setPending(true); setError(""); await remove(id, "reviewed removal"); await reload(); onMutation?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove block."); }
    finally { setPending(false); }
  }
  return <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div><p className="text-sm font-bold uppercase tracking-wide text-orange-700">DO NOT SEND controls</p><p className="text-sm text-slate-600">Use only a stable profile/contact/row ID or a complete normalized email address.</p></div>
    <div className="grid gap-2 sm:grid-cols-3"><select value={targetType} onChange={(event) => setTargetType(event.target.value)}><option value="recipient_email">Verified recipient email</option><option value="organization">Profile ID</option><option value="contact">Contact ID</option><option value="lead_import_row">Source row ID</option></select><input aria-label="Stable block target" value={target} onChange={(event) => setTarget(event.target.value)} /><input aria-label="Block reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
    <button className="button-secondary w-fit" disabled={pending || !target || !reason} onClick={() => void add()} type="button">Add DO NOT SEND block</button>
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    <ul className="grid gap-2">{blocks.map((block) => <li key={block.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2"><span>{block.targetType}: {block.normalizedEmail ?? block.organizationId ?? block.contactId ?? block.rowId} — {block.active ? "active" : "removed"}</span>{block.active ? <button className="button-secondary" disabled={pending} onClick={() => void removeBlock(block.id)} type="button">Remove</button> : null}</li>)}</ul>
  </section>;
}
