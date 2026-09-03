import { ArrowLeft, Settings2 } from "lucide-react";
import { Link } from "wouter";

import { readBookingReturnPath } from "@/lib/admin-workspace";

export default function MarketingHomePage() {
  const bookingReturnPath = readBookingReturnPath();

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketing</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Campaigns and outreach using the same Booking data.</p>
        </div>
        {bookingReturnPath ? (
          <Link className="button-secondary inline-flex items-center gap-2" href={bookingReturnPath ?? "/today"}><ArrowLeft className="h-4 w-4" />Back to Booking</Link>
        ) : (
          <Link className="button-secondary" href="/command">Command Panel</Link>
        )}
      </header>

      <section aria-labelledby="marketing-now" className="grid gap-3">
        <div><h2 className="text-xl font-bold" id="marketing-now">Marketing tools</h2></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/profiles"><h3 className="font-bold">Profiles</h3><p className="mt-1 text-sm text-muted-foreground">Event families, contacts, and cities.</p></Link>
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/office-coordinator"><h3 className="font-bold">Office Coordinator</h3><p className="mt-1 text-sm text-muted-foreground">Brochures, mail, and submitted outreach.</p></Link>
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/research-sources"><h3 className="font-bold">Research</h3><p className="mt-1 text-sm text-muted-foreground">Lead and event research.</p></Link>
          <Link className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-card-foreground shadow-sm hover:border-primary" data-testid="link-design-studio" href="/design-studio"><h3 className="font-bold">Design Studio</h3><p className="mt-1 text-sm text-muted-foreground">Create flyers, emails, contracts, and more.</p></Link>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div><h2 className="font-bold">Marketing setup</h2><p className="mt-1 text-sm text-muted-foreground">Connections, templates, imports, and settings.</p></div>
        <Link className="button-secondary inline-flex items-center gap-2" href="/settings"><Settings2 className="h-4 w-4" />Admin Tools</Link>
      </section>
    </div>
  );
}
