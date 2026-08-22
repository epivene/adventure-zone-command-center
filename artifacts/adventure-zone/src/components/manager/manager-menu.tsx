import { Link } from "wouter";
import { Check, ChevronDown, Menu, MessageCircle, Moon, Palette, Sun, Sunset } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readAppearance, saveAppearance, type Appearance } from "@/lib/appearance";

const groups = [
  { label: "Money & Travel", items: [
    { href: "/manager/receipts", label: "Receipts" },
    { href: "/manager/operations", label: "Mileage & Operations" },
  ] },
  { label: "Events", items: [
    { href: "/manager/reviews", label: "Event Reviews" },
    { href: "/manager/incidents", label: "Incidents" },
    { href: "/manager/incidents/new", label: "Report General Incident" },
  ] },
  { label: "Communication", items: [
    { href: "/manager/messages", label: "Messages" },
  ] },
];

const appearanceOptions = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "warm-light" as const, label: "Warm Light", icon: Sunset },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

export function ManagerMenu({ unreadMessages = 0, onSignOut }: { unreadMessages?: number; onSignOut(): void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance());

  function chooseAppearance(value: Appearance) {
    saveAppearance(value);
    setAppearance(value);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Menu" className="relative flex min-h-16 flex-col items-center justify-center gap-1 px-2 text-xs font-semibold text-slate-700" type="button">
          <Menu className="h-5 w-5" />Menu
          {unreadMessages ? <span className="absolute right-3 top-2 min-w-5 rounded-full bg-orange-600 px-1 text-[10px] font-bold leading-5 text-white">{unreadMessages > 99 ? "99+" : unreadMessages}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="mb-2 max-h-[72dvh] w-[min(92vw,24rem)] overflow-y-auto p-2">
        {groups.map((group, index) => {
          const expanded = openGroups[group.label] ?? index === 0;
          return <div className="py-1" key={group.label}>
            <button className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm font-bold hover:bg-slate-50" type="button" aria-expanded={expanded} onClick={(event) => { event.preventDefault(); setOpenGroups((current) => ({ ...current, [group.label]: !expanded })); }}>
              {group.label}<ChevronDown className={`h-4 w-4 ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded ? <div className="grid gap-0.5 pl-2">{group.items.map((item) => <DropdownMenuItem asChild key={item.href}>{item.href === "/manager/messages" ? <Link href={item.href} className="flex items-center justify-between"><span className="flex items-center gap-2"><MessageCircle className="h-4 w-4" />{item.label}</span>{unreadMessages ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800">{unreadMessages}</span> : null}</Link> : <Link href={item.href}>{item.label}</Link>}</DropdownMenuItem>)}</div> : null}
            {index < groups.length - 1 ? <DropdownMenuSeparator /> : null}
          </div>;
        })}
        <DropdownMenuSeparator />
        <div className="py-1">
          <div className="flex items-center gap-2 px-2 py-2 text-sm font-bold text-slate-800">
            <Palette className="h-4 w-4" /> Appearance
          </div>
          <div className="grid gap-0.5 pl-2">
            {appearanceOptions.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuItem key={option.value} onSelect={() => chooseAppearance(option.value)}>
                  <Icon className="mr-2 h-4 w-4" />
                  <span className="flex-1">{option.label}</span>
                  {appearance === option.value ? <Check aria-label="Selected" className="h-4 w-4 text-orange-600" /> : null}
                </DropdownMenuItem>
              );
            })}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
