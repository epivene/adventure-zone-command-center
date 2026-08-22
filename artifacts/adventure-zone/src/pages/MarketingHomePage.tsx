import { ArrowLeft, FileText, Mail, Megaphone, Settings2, UsersRound } from "lucide-react";
import { Link } from "wouter";

import { readBookingReturnPath } from "@/lib/admin-workspace";

const futureAreas = [
  { title: "Mass marketing emails", description: "Campaign-style outreach and promotional email runs.", icon: Mail },
  { title: "Brochures & promos", description: "Brochure campaigns, promo materials, and mailed-date tracking.", icon: FileText },
  { title: "Audiences & lists", description: "Reusable groups built from the same shared CRM profiles and contacts.", icon: UsersRound },
  { title: "Campaign history", description: "A home for completed campaigns, results, and future reporting.", icon: Megaphone },
] as const;

export default function MarketingHomePage() {
  const bookingReturnPath = readBookingReturnPath();

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Marketing workspace</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Marketing</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Promotional work lives here while still using the same shared profiles, contacts, and approved Google business context as Booking. Nothing is copied into a second CRM or Gmail archive.</p>
        </div>
        {bookingReturnPath ? (
          <Link className="button-secondary inline-flex items-center gap-2" href={bookingReturnPath ?? "/today"}><ArrowLeft className="h-4 w-4" />Back to Booking</Link>
        ) : (
          <Link className="button-secondary" href="/command">Command Panel</Link>
        )}
      </header>

      <section aria-labelledby="marketing-now" className="grid gap-3">
        <div><h2 className="text-xl font-bold" id="marketing-now">Useful right now</h2><p className="mt-1 text-sm text-muted-foreground">These open existing working areas without duplicating them inside Marketing.</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/profiles"><h3 className="font-bold">Profiles & audiences</h3><p className="mt-1 text-sm text-muted-foreground">Find event families, contacts, cities, and shared customer context.</p></Link>
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/office-coordinator"><h3 className="font-bold">Office Coordinator</h3><p className="mt-1 text-sm text-muted-foreground">Brochure/mail support and submitted outreach work.</p></Link>
          <Link className="rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm hover:border-orange-300" href="/research-sources"><h3 className="font-bold">Opportunity research</h3><p className="mt-1 text-sm text-muted-foreground">Use current lead and event research as campaign context.</p></Link>
        </div>
      </section>

      <section aria-labelledby="marketing-organized" className="grid gap-3">
        <div><h2 className="text-xl font-bold" id="marketing-organized">Marketing organization</h2><p className="mt-1 text-sm text-muted-foreground">These are the dedicated areas new marketing features will plug into as they are built. They are intentionally not dead buttons today.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {futureAreas.map(({ title, description, icon: Icon }) => (
            <article className="rounded-xl border border-dashed border-border bg-card p-4 text-card-foreground" key={title}>
              <div className="flex items-start gap-3"><span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400"><Icon className="h-5 w-5" /></span><div><h3 className="font-bold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div>
            </article>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground">
        <div><h2 className="font-bold">Marketing setup & shared data</h2><p className="mt-1 text-sm text-muted-foreground">Google Workspace connection/sync, templates, imports, and system settings stay under Admin Tools.</p></div>
        <Link className="button-secondary inline-flex items-center gap-2" href="/settings"><Settings2 className="h-4 w-4" />Admin Tools</Link>
      </section>
    </div>
  );
}
