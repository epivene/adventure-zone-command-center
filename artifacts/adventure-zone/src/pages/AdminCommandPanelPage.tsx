import { CalendarRange, PhoneCall, Settings2 } from "lucide-react";
import { Link } from "wouter";

const workspaces = [
  {
    title: "Booking",
    description: "Find it, contact it, book it.",
    detail: "Profiles, calls, follow-ups, bookings, packages, and the schedule you use while selling.",
    href: "/today",
    icon: PhoneCall,
  },
] as const;

export default function AdminCommandPanelPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 py-4 md:py-8">
      <header className="text-center">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-orange-700">Administrator</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Command Panel</h1>
      </header>

      <section aria-label="Administrator workspaces" className="grid gap-4">
        {workspaces.map((workspace) => {
          const Icon = workspace.icon;
          return (
            <Link
              className="group flex min-h-64 flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
              href={workspace.href}
              key={workspace.title}
            >
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-orange-700"><Icon className="h-6 w-6" /></span>
              <h2 className="mt-5 text-2xl font-bold">{workspace.title}</h2>
              <p className="mt-2 font-semibold text-orange-700">{workspace.description}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{workspace.detail}</p>
              <span className="mt-auto pt-6 text-sm font-bold text-slate-900 group-hover:text-orange-700">Open {workspace.title} →</span>
            </Link>
          );
        })}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Settings2 className="h-5 w-5" /></span>
          <div><h2 className="font-bold">Admin Tools</h2><p className="mt-1 text-sm text-muted-foreground">Google Workspace and ChatGPT connections, call scripts, package/resource setup, and occasional system maintenance.</p></div>
        </div>
        <Link className="button-secondary mt-4 inline-flex shrink-0 items-center gap-2 sm:mt-0" href="/settings"><CalendarRange className="h-4 w-4" />Open Admin Tools</Link>
      </section>
    </div>
  );
}
