import { useEffect, useState } from "react";
import { Link } from "wouter";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossGet } from "@/lib/boss-auth-context";
import type { BossContact } from "@/lib/boss-types";
import { BossProfileDirectoryNav } from "@/components/boss/boss-profile-directory-nav";

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
          {contact.role || contact.jobTitle ? `${contact.role ?? contact.jobTitle} · ` : ""}
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
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const term = search.trim();
    const timeout = window.setTimeout(() => {
      setLoading(contacts.length === 0);
      setError(null);
      const path = term ? `/boss/contacts?q=${encodeURIComponent(term)}` : "/boss/contacts";
      void bossGet<{ contacts: BossContact[] } | BossContact[]>(path)
        .then((data) => {
          if (active) setContacts(Array.isArray(data) ? data : (data.contacts ?? []));
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : "Could not load contacts.");
        })
        .finally(() => { if (active) setLoading(false); });
    }, term ? 150 : 0);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [search, reloadKey]);

  return (
    <div className="grid gap-5" data-testid="boss-contacts-page">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
        <h1 className="mt-0.5 text-2xl font-bold text-foreground">Contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search contacts by name, profile, location, email, or phone.</p>
      </header>

      <BossProfileDirectoryNav active="contacts" />

      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          style={{ paddingLeft: "3rem" }}
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-contacts-search"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => setReloadKey((value) => value + 1)} variant="outline" size="sm" className="ml-3">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}

      {loading && contacts.length === 0 ? (
        <div className="grid gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : contacts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="contacts-empty">
          <p className="font-semibold text-foreground">No contacts found.</p>
          {search ? <p className="mt-1 text-sm text-muted-foreground">Try a different search.</p> : null}
        </div>
      ) : (
        <div className="grid gap-2">
          {contacts.map((c) => <ContactRow key={c.id} contact={c} />)}
        </div>
      )}
    </div>
  );
}
