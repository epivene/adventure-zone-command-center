import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

import { contractClient } from "@/features/contracts/contract-client";

type BookingChoice = { id: string; name: string; openDraftId: string | null };

export function ContractAction({
  bookingId,
  bookings,
  onNavigate,
}: {
  bookingId?: string;
  bookings: BookingChoice[];
  onNavigate?: (path: string) => void;
}) {
  const [, setLocation] = useLocation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [selectedId, setSelectedId] = useState(bookingId ?? (bookings.length === 1 ? bookings[0]?.id ?? "" : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => bookings.find((booking) => booking.id === selectedId) ?? null, [bookings, selectedId]);
  const navigate = onNavigate ?? setLocation;

  useEffect(() => {
    let cancelled = false;
    contractClient.getSettings().then((settings) => { if (!cancelled) setEnabled(settings.enabled); })
      .catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  if (enabled !== true || bookings.length === 0) return null;

  async function open() {
    if (!selected && bookings.length > 1) {
      setChoosing(true);
      return;
    }
    if (!selected || busy) return;
    if (selected.openDraftId) {
      navigate(`/contracts/drafts/${selected.openDraftId}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await contractClient.startDraft(selected.id);
      navigate(`/contracts/drafts/${result.draft.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start the contract.");
      setBusy(false);
    }
  }

  const label = selected?.openDraftId ? "Continue contract" : "Create contract";
  return (
    <div className="grid gap-2">
      {choosing ? <label className="grid gap-1 text-sm font-semibold">Choose booking
        <select aria-label="Choose booking" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Select an event</option>
          {bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.name}</option>)}
        </select>
      </label> : null}
      <button className="button-secondary min-h-11" disabled={busy || (choosing && !selected)} onClick={() => void open()} type="button">
        {busy ? "Starting contract…" : label}
      </button>
      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}
