import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet } from "@/lib/boss-auth-context";
import type { BossBooking } from "@/lib/boss-types";

function statusVariant(status?: string | null): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "confirmed": return "default";
    case "cancelled": return "destructive";
    case "completed": return "secondary";
    default: return "outline";
  }
}

export default function BossBookingDetailPage({ bookingId }: { bookingId: string }) {
  const [booking, setBooking] = useState<BossBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<BossBooking | { booking: BossBooking }>(`/boss/bookings/${bookingId}`);
      setBooking("id" in data ? data as BossBooking : (data as { booking: BossBooking }).booking);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load booking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [bookingId]);

  if (loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center" role="alert">
        <p className="font-semibold text-destructive">{error ?? "Booking not found."}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={() => void load()} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
          <Link href="/boss/bookings" className="text-sm font-semibold text-primary hover:underline">
            Back to Bookings
          </Link>
        </div>
      </div>
    );
  }

  const fields = Object.entries(booking).filter(
    ([k]) => !["id"].includes(k)
  );

  return (
    <div className="grid gap-5 max-w-2xl" data-testid="boss-booking-detail">
      <div className="flex items-center gap-2">
        <Link href="/boss/bookings" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Bookings
        </Link>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {booking.name ?? booking.organization?.name ?? booking.organizationName ?? booking.contactName ?? "Booking"}
          </h1>
          {booking.startsAt || booking.eventDate ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date(booking.startsAt ?? booking.eventDate!).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          ) : null}
        </div>
        <Badge variant={statusVariant(booking.status)} className="capitalize text-sm px-3 py-1">
          {booking.status ?? "pending"}
        </Badge>
      </header>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map(([key, value]) => {
            if (value == null || value === "") return null;
            const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
            const display = key.includes("Date") || key.includes("At")
              ? (() => { try { return new Date(String(value)).toLocaleString(); } catch { return String(value); } })()
              : key.includes("Amount") || key.includes("amount")
                ? `$${Number(value).toLocaleString()}`
                : typeof value === "object" ? JSON.stringify(value) : String(value);
            return (
              <div key={key}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-sm text-foreground">{display}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </div>
  );
}
