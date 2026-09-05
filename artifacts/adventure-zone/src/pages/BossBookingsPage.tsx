import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, RefreshCw, Search } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@workspace/avz-crm/components/ui/dialog";
import { bossGet, bossPost, bossPatch } from "@/lib/boss-auth-context";
import type { BossBooking } from "@/lib/boss-types";

function statusVariant(status?: string | null): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "confirmed": return "default";
    case "cancelled": return "destructive";
    case "completed": return "secondary";
    default: return "outline";
  }
}

type NewBookingFields = {
  organizationName: string;
  eventDate: string;
  city: string;
  region: string;
  notes: string;
};

function CreateBookingDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose(): void;
  onCreated(): void;
}) {
  const [fields, setFields] = useState<NewBookingFields>({
    organizationName: "", eventDate: "", city: "", region: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(key: keyof NewBookingFields, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await bossPost("/boss/bookings", {
        name: fields.organizationName.trim(),
        eventDate: fields.eventDate || null,
        city: fields.city.trim(),
        region: fields.region.trim(),
        notes: fields.notes.trim() || null,
      });
      setFields({ organizationName: "", eventDate: "", city: "", region: "", notes: "" });
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Booking</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
          <label className="grid gap-1 text-sm font-semibold">
            Organization / client name
            <Input
              value={fields.organizationName}
              onChange={(e) => patch("organizationName", e.target.value)}
              placeholder="Event organization name"
              data-testid="input-booking-org"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Event date
            <Input
              type="date"
              value={fields.eventDate}
              onChange={(e) => patch("eventDate", e.target.value)}
              data-testid="input-booking-date"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm font-semibold">
              City
              <Input value={fields.city} onChange={(e) => patch("city", e.target.value)} placeholder="City" />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              State
              <Input value={fields.region} onChange={(e) => patch("region", e.target.value)} placeholder="UT" />
            </label>
          </div>
          <label className="grid gap-1 text-sm font-semibold">
            Notes
            <textarea
              className="resize-none"
              rows={2}
              value={fields.notes}
              onChange={(e) => patch("notes", e.target.value)}
              placeholder="Optional notes"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !fields.organizationName.trim() || !fields.city.trim() || fields.region.trim().length < 2}
            data-testid="button-create-booking"
          >
            {busy ? "Creating…" : "Create Booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EditFields = { status: string; notes: string };

function EditBookingDialog({ booking, onClose, onSaved }: {
  booking: BossBooking;
  onClose(): void;
  onSaved(): void;
}) {
  const [fields, setFields] = useState<EditFields>({
    status: booking.status ?? "new_lead",
    notes: (booking.notes as string) ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await bossPatch(`/boss/bookings/${booking.id}`, {
        status: fields.status,
        notes: fields.notes.trim() || null,
      });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Booking</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {error ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p> : null}
          <p className="font-semibold">{booking.organizationName ?? "Booking"}</p>
          <label className="grid gap-1 text-sm font-semibold">
            Status
            <select
              value={fields.status}
              onChange={(e) => setFields((f) => ({ ...f, status: e.target.value }))}
              data-testid="select-booking-status"
            >
              {["new_lead", "researching", "contact_due", "contacted", "interested", "possible", "unlikely", "quote_sent", "pending_decision", "pending_contract", "contract_received", "confirmed", "declined", "cancelled", "completed", "renewal_due"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Notes
            <textarea
              className="resize-none"
              rows={3}
              value={fields.notes}
              onChange={(e) => setFields((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Notes"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy} data-testid="button-save-booking">
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BossBookingsPage() {
  const [bookings, setBookings] = useState<BossBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<BossBooking | null>(null);
  const [, setLocation] = useLocation();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<{ bookings: BossBooking[] } | BossBooking[]>("/boss/bookings");
      setBookings(Array.isArray(data) ? data : (data.bookings ?? []));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = bookings.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [b.name, b.organization?.name, b.organizationName, b.contactName, b.city, b.region, b.status]
      .some((v) => v?.toString().toLowerCase().includes(q));
  });

  return (
    <div className="grid gap-5" data-testid="boss-bookings-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Bookings</h1>
        </div>
        <Button onClick={() => setShowCreate(true)} data-testid="button-new-booking">
          <Plus className="mr-2 h-4 w-4" /> New Booking
        </Button>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search bookings…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-bookings-search"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void load()} variant="outline" size="sm" className="ml-3">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="bookings-empty">
          <p className="font-semibold text-foreground">No bookings found.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search ? "Try a different search." : "Create the first booking."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/40 transition-colors"
              data-testid={`booking-row-${b.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-foreground truncate">
                    {b.name ?? b.organization?.name ?? b.organizationName ?? b.contactName ?? "Booking"}
                  </p>
                  <Badge variant={statusVariant(b.status)} className="capitalize">
                    {b.status ?? "pending"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {b.startsAt || b.eventDate ? new Date(b.startsAt ?? b.eventDate!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Date TBD"}
                  {b.city ? ` · ${b.city}${b.region ? `, ${b.region}` : ""}` : ""}
                  {b.totalAmount != null ? ` · $${Number(b.totalAmount).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing(b)}
                  data-testid={`button-edit-booking-${b.id}`}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLocation(`/boss/bookings/${b.id}`)}
                  data-testid={`button-view-booking-${b.id}`}
                >
                  View
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateBookingDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => void load()}
      />
      {editing ? (
        <EditBookingDialog
          booking={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}
