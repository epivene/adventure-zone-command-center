import { useEffect, useState } from "react";
import { Link } from "wouter";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet } from "@/lib/boss-auth-context";
import type { BossContact } from "@/lib/boss-types";

function ContactRow({ contact }: { contact: BossContact }) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Contact";
  return (
    <Link
      href={`/boss/contacts/${contact.id}`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/40 transition-colors"
      data-testid={`contact-row-${contact.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground truncate">{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {contact.organizationName ? `${contact.organizationName} · ` : ""}
          {contact.role ? `${contact.role} · ` : ""}
          {[contact.city, contact.region].filter(Boolean).join(", ")}
        </p>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        {contact.email ? <p>{contact.email}</p> : null}
        {contact.phone ? <p>{contact.phone}</p> : null}
      </div>
    </Link>
  );
}

export default function BossContactsPage() {
  const [contacts, setContacts] = useState<BossContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossGet<{ contacts: BossContact[] } | BossContact[]>("/boss/contacts");
      setContacts(Array.isArray(data) ? data : (data.contacts ?? []));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load contacts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [c.firstName, c.lastName, c.email, c.phone, c.organizationName, c.city, c.region]
      .some((v) => v?.toString().toLowerCase().includes(q));
  });

  return (
    <div className="grid gap-5" data-testid="boss-contacts-page">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
        <h1 className="mt-0.5 text-2xl font-bold text-foreground">Contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Read-only visibility across all contacts.</p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-contacts-search"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void load()} variant="outline" size="sm" className="ml-3">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="contacts-empty">
          <p className="font-semibold text-foreground">No contacts found.</p>
          {search ? <p className="mt-1 text-sm text-muted-foreground">Try a different search.</p> : null}
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((c) => <ContactRow key={c.id} contact={c} />)}
        </div>
      )}
    </div>
  );
}
