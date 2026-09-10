import { Building2, ContactRound } from "lucide-react";
import { Link } from "wouter";

export function BossProfileDirectoryNav({ active }: { active: "profiles" | "contacts" }) {
  const items = [
    { key: "profiles" as const, href: "/boss/profiles", label: "Profiles", icon: Building2 },
    { key: "contacts" as const, href: "/boss/contacts", label: "Contacts", icon: ContactRound },
  ];

  return (
    <nav aria-label="Profile directory" className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            aria-current={active === item.key ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition ${active === item.key ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            href={item.href}
            key={item.key}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
