import { useRef, useState } from "react";
import { Link } from "wouter";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { queueManagerMutation, flushManagerMutationQueue } from "@/lib/manager-sync-queue";
import { queueManagerBlob, flushManagerBlobQueue } from "@/lib/manager-blob-queue";
import { ManagerSyncStatus } from "@/components/manager/manager-sync-status";

type SaveState = "saved_offline" | "synced" | "needs_attention";

export default function ManagerIncidentPage() {
  const { manager, managerApi } = useManagerAuth();
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [action, setAction] = useState("");
  const [people, setPeople] = useState("");
  const [location, setLocation] = useState("");
  const [follow, setFollow] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<SaveState | "syncing" | null>(null);
  const [saved, setSaved] = useState(false);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    setType("");
    setDescription("");
    setAction("");
    setPeople("");
    setLocation("");
    setFollow(false);
    setFile(null);
    setState(null);
    setSaved(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!manager) return;
    const incidentId = crypto.randomUUID();
    const mutationId = crypto.randomUUID();
    await queueManagerMutation({
      id: mutationId,
      legId: manager.legId,
      path: "/manager/incidents",
      method: "POST",
      body: {
        id: incidentId,
        type,
        occurredAt: new Date().toISOString(),
        bookingId: null,
        tripId: null,
        locationText: location || null,
        peopleInvolved: people || null,
        description,
        actionTaken: action || null,
        followUpNeeded: follow,
        clientMutationId: mutationId,
      },
      createdAt: new Date().toISOString(),
    });
    let attachmentId: string | null = null;
    if (file) {
      attachmentId = crypto.randomUUID();
      await queueManagerMutation({
        id: attachmentId,
        legId: manager.legId,
        path: "/manager/incident-attachments",
        method: "POST",
        body: { id: attachmentId, incidentId, clientMutationId: attachmentId, mimeType: file.type || "image/jpeg" },
        createdAt: new Date(Date.now() + 1).toISOString(),
      });
      await queueManagerBlob({ id: attachmentId, legId: manager.legId, receiptId: attachmentId, kind: "incident", blob: file, createdAt: new Date().toISOString() });
    }

    setState("saved_offline");
    setSaved(true);
    if (!navigator.onLine) return;

    setState("syncing");
    const mutations = await flushManagerMutationQueue(managerApi);
    const incidentMutation = mutations.find((row) => row.id === mutationId);
    const attachmentMutation = attachmentId ? mutations.find((row) => row.id === attachmentId) : null;
    if (incidentMutation?.state === "needs_attention" || attachmentMutation?.state === "needs_attention") {
      setState("needs_attention");
      return;
    }
    if (attachmentId) {
      const blobs = await flushManagerBlobQueue(
        async row => {
          await managerApi(`/manager/incident-attachments/${row.receiptId}/image`, {
            method: "PUT",
            headers: { "Content-Type": row.blob.type || "image/jpeg" },
            body: row.blob,
          });
        },
        undefined,
        async row => row.kind === "incident" && row.receiptId === attachmentId,
      );
      if (blobs.find((row) => row.id === attachmentId)?.state === "image_failed") {
        setState("needs_attention");
        return;
      }
    }
    setState("synced");
  }

  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  if (saved) {
    return <div className="grid gap-4">
      <div><h1 className="text-2xl font-bold">General incident</h1><p className="text-sm text-slate-600">Your report has been saved.</p></div>
      {state ? <ManagerSyncStatus state={state} /> : null}
      {state === "synced" ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-bold text-emerald-900">Incident saved and synced</h2><p className="mt-1 text-sm text-emerald-800">The incident and its photo are now saved to the manager record.</p></div> : state === "saved_offline" ? <p className="text-sm text-amber-900">You can leave this screen. The report will sync automatically when the connection returns.</p> : state === "needs_attention" ? <p className="text-sm font-semibold text-rose-700">The report is saved on this device, but part of the sync needs attention.</p> : null}
      <div className="flex flex-wrap gap-2"><Link className="button-primary" href="/manager/incidents">View incidents</Link><button className="button-secondary" type="button" onClick={reset}>Report another</button></div>
    </div>;
  }

  return <form onSubmit={submit} className="grid gap-3">
    <div><h1 className="text-2xl font-bold">General incident</h1><p className="text-sm text-slate-600">Report something that happened on the leg at any time. No event or trip is required.</p></div>
    <label className="grid gap-1 font-semibold">Incident type<input aria-label="Incident type" value={type} onChange={(event) => setType(event.target.value)} required /></label>
    <label className="grid gap-1 font-semibold">Location<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
    <label className="grid gap-1 font-semibold">People involved<textarea value={people} onChange={(event) => setPeople(event.target.value)} /></label>
    <label className="grid gap-1 font-semibold">Description<textarea aria-label="Incident description" value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
    <label className="grid gap-1 font-semibold">Action taken<textarea value={action} onChange={(event) => setAction(event.target.value)} /></label>
    <label className="flex gap-2"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />Follow-up needed</label>
    <div className="grid gap-2"><span className="font-semibold">Photo</span><div className="grid grid-cols-2 gap-2"><button className="button-secondary" type="button" onClick={() => cameraRef.current?.click()}>Take photo</button><button className="button-secondary" type="button" onClick={() => galleryRef.current?.click()}>Choose from gallery</button></div><input ref={cameraRef} className="sr-only" aria-label="Take incident photo" type="file" accept="image/*" capture="environment" onChange={choosePhoto} /><input ref={galleryRef} className="sr-only" aria-label="Choose incident photo from gallery" type="file" accept="image/*" onChange={choosePhoto} />{file ? <p className="text-sm text-slate-600">Selected: {file.name}</p> : null}</div>
    <button className="button-primary" disabled={state === "syncing"}>{state === "syncing" ? "Saving…" : "Save general incident"}</button>
  </form>;
}
