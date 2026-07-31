import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/today", label: "Today" },
  { href: "/bookings", label: "Bookings" },
  { href: "/organizations", label: "Places" },
  { href: "/contacts", label: "Contacts" },
  { href: "/calendar", label: "Calendar" },
  { href: "/routes", label: "Routes" },
];

function QuickAddButton({ className }: { className: string }) {
  return (
    <Link
      aria-label="Quick Add caller"
      className={`${className} w-full rounded-lg bg-orange-600 px-4 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600`}
      href="/quick-add"
    >
      Quick Add
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-5 md:flex">
        <Link className="mb-8 text-lg font-bold tracking-tight" href="/today">
          Adventure Zone
          <span className="block text-sm font-medium text-slate-500">Command Center</span>
        </Link>
        <nav aria-label="Main navigation" className="grid gap-1">
          {navigation.map((item) => (
            <Link
              className="rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
          <details className="group mt-2">
            <summary className="cursor-pointer rounded-lg px-3 py-2 font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
              Settings
            </summary>
            <div className="mt-1 grid">
              <Link
                className="block rounded-lg px-6 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                href="/settings/act-sync"
              >
                Act! Sync
              </Link>
              <Link
                className="block rounded-lg px-6 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                href="/settings/act-migration"
              >
                Act! migration
              </Link>
              <Link
                className="block rounded-lg px-6 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                href="/settings/import"
              >
                Import fallback
              </Link>
              <Link
                className="block rounded-lg px-6 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                href="/settings/packages-resources"
              >
                Packages &amp; resources
              </Link>
            </div>
          </details>
        </nav>
        <QuickAddButton className="mt-auto" />
      </aside>

      <main className="min-h-screen px-4 py-6 pb-28 md:ml-64 md:px-8 md:py-8 md:pb-8">
        {children}
      </main>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-8 border-t border-slate-200 bg-white p-2 shadow-[0_-4px_12px_rgba(15,23,42,0.08)] md:hidden"
      >
        {navigation.map((item) => (
          <Link
            className="flex min-h-12 items-center justify-center rounded-md px-1 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
        <details className="relative flex items-center justify-center">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-md px-1 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600">
            Settings
          </summary>
          <div className="absolute bottom-14 right-0 grid min-w-40 rounded-md border border-slate-200 bg-white p-1 text-sm font-semibold text-slate-700 shadow-lg">
            <Link
              className="rounded px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
              href="/settings/act-sync"
            >
              Act! Sync
            </Link>
            <Link
              className="rounded px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
              href="/settings/act-migration"
            >
              Act! migration
            </Link>
            <Link
              className="rounded px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
              href="/settings/import"
            >
              Import fallback
            </Link>
            <Link
              className="rounded px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
              href="/settings/packages-resources"
            >
              Packages &amp; resources
            </Link>
          </div>
        </details>
        <QuickAddButton className="flex items-center" />
      </nav>
    </div>
  );
}
