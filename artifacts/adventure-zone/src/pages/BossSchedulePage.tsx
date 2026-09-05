import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet, bossPatch, bossPut } from "@/lib/boss-auth-context";
import type { BossBooking, BossSchedule, ScheduleLeg } from "@/lib/boss-types";

function LegCard({ leg, onChanged }: { leg: ScheduleLeg; onChanged(): Promise<void> }) {
  const stops = leg.stops ?? [];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(leg.name ?? "");
  const [baseAddress, setBaseAddress] = useState(leg.baseAddress ?? "");
  const [vehicle, setVehicle] = useState(leg.defaultVehicleName ?? "");
  const [mpg, setMpg] = useState(leg.defaultMpg == null ? "" : String(leg.defaultMpg));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await bossPatch(`/boss/legs/${leg.id}`, {
        name: name.trim(),
        baseAddress: baseAddress.trim() || null,
        defaultVehicleName: vehicle.trim() || null,
        defaultMpg: mpg ? Number(mpg) : null,
      });
      setEditing(false);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save leg.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchived() {
    setSaving(true);
    setError("");
    try {
      await bossPatch(`/boss/legs/${leg.id}`, {
        archivedAt: leg.archivedAt ? null : new Date().toISOString(),
      });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update leg.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={`leg-card-${leg.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-foreground">{leg.name ?? `Leg ${leg.id}`}</p>
          {leg.startDate || leg.endDate ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {leg.startDate ? new Date(leg.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
              {leg.startDate && leg.endDate ? " – " : ""}
              {leg.endDate ? new Date(leg.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
            </p>
          ) : null}
        </div>
        <Badge variant="outline" className="capitalize">{leg.archivedAt ? "Archived" : "Active"}</Badge>
      </div>

      {editing ? (
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-foreground">Leg name<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold text-foreground">Vehicle<Input value={vehicle} onChange={(event) => setVehicle(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold text-foreground sm:col-span-2">Base address<Input value={baseAddress} onChange={(event) => setBaseAddress(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold text-foreground">Default MPG<Input inputMode="decimal" value={mpg} onChange={(event) => setMpg(event.target.value)} /></label>
          <div className="flex items-end gap-2">
            <Button size="sm" disabled={saving || !name.trim() || (mpg !== "" && (!Number.isFinite(Number(mpg)) || Number(mpg) <= 0))} onClick={() => void save()}>Save leg</Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : null}

      {leg.route ? (
        <p className="mt-2 text-sm text-muted-foreground">{leg.route}</p>
      ) : null}

      {stops.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Stops ({stops.length})
          </p>
          <ol className="grid gap-1.5">
            {stops.map((stop, idx) => (
              <li
                key={stop.id}
                className="flex items-start gap-2 text-sm"
                data-testid={`stop-${stop.id}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {idx + 1}
                </span>
                <div>
                  <span className="font-semibold text-foreground">{stop.name ?? stop.city ?? `Stop ${idx + 1}`}</span>
                  {stop.city || stop.region ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {[stop.city, stop.region].filter(Boolean).join(", ")}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {leg.bookings?.length ? <p className="mt-3 text-xs text-muted-foreground">{leg.bookings.length} assigned booking{leg.bookings.length === 1 ? "" : "s"} · {leg.trips?.length ?? 0} trip{leg.trips?.length === 1 ? "" : "s"}</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing((value) => !value)} data-testid={`button-leg-edit-${leg.id}`}>Edit leg</Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={() => void toggleArchived()} data-testid={`button-leg-archive-${leg.id}`}>
          {leg.archivedAt ? "Restore leg" : "Archive leg"}
        </Button>
      </div>
    </section>
  );
}

export default function BossSchedulePage() {
  const [schedule, setSchedule] = useState<BossSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [legData, bookingData] = await Promise.all([
        bossGet<{ legs: ScheduleLeg[] }>("/boss/legs"),
        bossGet<{ bookings: BossBooking[] }>("/boss/bookings"),
      ]);
      setSchedule({
        legs: Array.isArray(legData.legs) ? legData.legs : [],
        bookings: Array.isArray(bookingData.bookings) ? bookingData.bookings : [],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load schedule.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function assignBookingToLeg(bookingId: string, legId: string) {
    setError(null);
    try {
      await bossPut(`/boss/bookings/${bookingId}/leg`, { legId: legId || null });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign booking to leg.");
    }
  }

  return (
    <div className="grid gap-5" data-testid="boss-schedule-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Schedule</h1>
        </div>
        <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

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
          {[1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* Legs */}
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Legs ({schedule?.legs.length ?? 0})
            </h2>
            {(schedule?.legs ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center" data-testid="legs-empty">
                <p className="text-sm text-muted-foreground">No legs in the schedule yet.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {(schedule?.legs ?? []).map((leg) => <LegCard key={leg.id} leg={leg} onChanged={load} />)}
              </div>
            )}
          </section>

          {/* Booked events on schedule */}
          {(schedule?.bookings ?? []).length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Booked Events ({schedule?.bookings.length ?? 0})
              </h2>
              <div className="grid gap-2">
                {(schedule?.bookings ?? []).map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                    data-testid={`schedule-booking-${b.id}`}
                  >
                    <div>
                      <p className="font-semibold text-foreground">{b.name ?? b.organizationName ?? "Event"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {b.startsAt || b.eventDate ? new Date(b.startsAt ?? b.eventDate!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "TBD"}
                        {b.city ? ` · ${b.city}${b.region ? `, ${b.region}` : ""}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.status ? <Badge variant="outline" className="capitalize">{b.status}</Badge> : null}
                      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                        Leg
                        <select className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" value={b.travelLegId ?? ""} onChange={(event) => void assignBookingToLeg(b.id, event.target.value)}>
                          <option value="">Unassigned</option>
                          {(schedule?.legs ?? []).filter((leg) => !leg.archivedAt || leg.id === b.travelLegId).map((leg) => <option key={leg.id} value={leg.id}>{leg.name ?? "Unnamed leg"}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
