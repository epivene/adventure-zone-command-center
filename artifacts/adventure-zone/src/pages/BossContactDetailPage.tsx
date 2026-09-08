import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet } from "@/lib/boss-auth-context";
import type { BossContact } from "@/lib/boss-types";

export default function BossContactDetailPage({ contactId }: { contactId: string }) {
  const [contact, setContact] = useState<BossContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<BossContact | { contact: BossContact }>(`/boss/contacts/${contactId}`);
      setContact("id" in data ? data as BossContact : (data as { contact: BossContact }).contact);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load contact.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [contactId]);

  if (loading) {
    return (
      <div className="grid gap-4 max-w-xl">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center" role="alert">
        <p className="font-semibold text-destructive">{error ?? "Contact not found."}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button onClick={() => void load()} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
          <Link href="/boss/contacts" className="text-sm font-semibold text-primary hover:underline">
            Back to Contacts
          </Link>
        </div>
      </div>
    );
  }

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";
  const fields = Object.entries(contact).filter(([k, v]) => k !== "id" && v != null && v !== "");

  return (
    <div className="grid gap-5 max-w-xl" data-testid="boss-contact-detail">
      <div className="flex items-center gap-2">
        <Link href="/boss/contacts" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Contacts
        </Link>
      </div>
      <header>
        <h1 className="text-2xl font-bold text-foreground">{name}</h1>
        {contact.organizationName ? (
          <p className="mt-1 text-sm text-muted-foreground">{contact.organizationName}</p>
        ) : null}
      </header>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map(([key, value]) => {
            const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
            const display = typeof value === "object" ? JSON.stringify(value) : String(value);
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
