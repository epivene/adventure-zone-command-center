/**
 * MarketingCampaignsPage — shell routing to focused marketing modules.
 * No localStorage for campaigns or audiences. Promos are browser-local and disclosed.
 */
import { useState } from "react";
import { FileText, Mail, Megaphone, UsersRound, X } from "lucide-react";
import { Link, useSearch } from "wouter";

import { cn } from "@workspace/avz-crm/lib/utils";

import { AudiencesTab } from "@/features/marketing/AudiencesTab";
import { CampaignHistoryTab } from "@/features/marketing/CampaignHistory";
import { EmailCampaignsTab } from "@/features/marketing/EmailCampaignsTab";
import { PromosTab } from "@/features/marketing/PromosTab";
import type { Area } from "@/features/marketing/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function areaFromSearch(search: string): Area {
  const v = new URLSearchParams(search).get("area");
  return v === "promos" || v === "audiences" || v === "history" ? v : "email";
}

// ─── Page shell ───────────────────────────────────────────────────────────────

export default function MarketingCampaignsPage() {
  const search = useSearch();
  const area = areaFromSearch(search);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const tabs: [Area, string, typeof Mail][] = [
    ["email", "Email Campaigns", Mail],
    ["promos", "Brochures & Promos", FileText],
    ["audiences", "Audiences", UsersRound],
    ["history", "Campaign History", Megaphone],
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Breadcrumb */}
      <div className="border-b border-border bg-card px-4 py-3">
        <nav className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Dashboard
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">Marketing</span>
        </nav>
        <h1 className="mt-1 text-2xl font-bold">Marketing</h1>
      </div>

      {/* Notice banner */}
      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-start justify-between gap-3 border-b px-4 py-2 text-sm",
            notice.kind === "ok"
              ? "border-primary/20 bg-primary/5 text-primary"
              : "border-destructive/20 bg-destructive/5 text-destructive",
          )}
          data-testid="notice-banner"
        >
          <span>{notice.text}</span>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tab nav */}
      <div className="border-b border-border bg-card">
        <nav className="flex overflow-x-auto px-4">
          {tabs.map(([key, label, Icon]) => (
            <Link
              key={key}
              href={`/marketing?area=${key}`}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                area === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`tab-${key}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {area === "email" && <EmailCampaignsTab setNotice={setNotice} />}
        {area === "promos" && <PromosTab setNotice={setNotice} />}
        {area === "audiences" && <AudiencesTab setNotice={setNotice} />}
        {area === "history" && <CampaignHistoryTab setNotice={setNotice} />}
      </main>
    </div>
  );
}
