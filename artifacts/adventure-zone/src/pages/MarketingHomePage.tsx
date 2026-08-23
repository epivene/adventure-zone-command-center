import { ArrowLeft, FileText, Mail, Megaphone, Settings2, UsersRound } from "lucide-react";
import { Link } from "wouter";

import { readBookingReturnPath } from "@/lib/admin-workspace";

const futureAreas = [
  { title: "Email campaigns", description: "Promotional email runs.", icon: Mail },
  { title: "Brochures & promos", description: "Brochures, promos, and mailed-date tracking.", icon: FileText },
  { title: "Audiences & lists", description: "Reusable groups from shared profiles and contacts.", icon: UsersRound },
  { title: "Campaign history", description: "Completed campaigns and results.", icon: Megaphone },
] as const;

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
        <div><h2 className="text-xl font-bold" id="marketing-now">Use now</h2></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/profiles"><h3 className="font-bold">Profiles</h3><p className="mt-1 text-sm text-muted-foreground">Event families, contacts, and cities.</p></Link>
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/office-coordinator"><h3 className="font-bold">Office Coordinator</h3><p className="mt-1 text-sm text-muted-foreground">Brochures, mail, and submitted outreach.</p></Link>
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/research-sources"><h3 className="font-bold">Research</h3><p className="mt-1 text-sm text-muted-foreground">Lead and event research.</p></Link>
        </div>
      </section>

      <section aria-labelledby="marketing-organized" className="grid gap-3">
        <div><h2 className="text-xl font-bold" id="marketing-organized">Campaigns</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {futureAreas.map(({ title, description, icon: Icon }) => (
            <article className="rounded-xl border border-dashed border-border bg-card p-4 text-card-foreground" key={title}>
              <div className="flex items-start gap-3"><span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400"><Icon className="h-5 w-5" /></span><div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div>
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div><h2 className="font-bold">Marketing setup</h2><p className="mt-1 text-sm text-muted-foreground">Connections, templates, imports, and settings.</p></div>
        <Link className="button-secondary inline-flex items-center gap-2" href="/settings"><Settings2 className="h-4 w-4" />Admin Tools</Link>
      </section>
    </div>
  );
}
