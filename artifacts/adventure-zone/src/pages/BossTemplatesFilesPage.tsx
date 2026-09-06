import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Download, FileCheck2, FileText, Mail, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import {
  bossDocumentsApi,
  type BossCertificateDocument,
  type BossContractDocument,
  type BossDocumentsResponse,
  type BossEmailDocument,
} from "@/lib/boss-documents-api";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Not recorded"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center text-muted-foreground">{icon}</div>
      <p className="mt-2 font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function ContractCard({ document }: { document: BossContractDocument }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-foreground">{document.projectName}</p>
          <p className="mt-1 text-xs text-muted-foreground">Prepared {dateLabel(document.createdAt)}</p>
        </div>
        <Badge variant={document.contractState === "signed" ? "default" : "secondary"}>
          {label(document.contractState)}
        </Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {document.fileUrl ? (
          <Button asChild size="sm" variant="ghost">
            <a href={document.fileUrl} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Open file
            </a>
          </Button>
        ) : (
          <span className="self-center text-xs text-muted-foreground">Export file unavailable</span>
        )}
      </div>
    </article>
  );
}

function CertificateCard({ document }: { document: BossCertificateDocument }) {
  const destination = document.bookingId
    ? `/boss/bookings/${document.bookingId}`
    : document.organizationId ? `/boss/contacts/${document.organizationId}` : null;
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-foreground">{document.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {document.bookingName ?? document.organizationName ?? "No event or profile linked"}
          </p>
        </div>
        <div className="flex gap-1">
          <Badge variant={document.expirationState === "expired" ? "destructive" : document.expirationState === "current" ? "secondary" : "outline"}>
            {label(document.expirationState)}
          </Badge>
          <Badge variant={document.reviewState === "reviewed" ? "default" : "secondary"}>
            {label(document.reviewState)}
          </Badge>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
         {document.expirationState.replace("_", " ")} · Expires {dateLabel(document.expirationDate)} · Added {dateLabel(document.createdAt)}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {document.fileUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={document.fileUrl} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Open COI
            </a>
          </Button>
        ) : (
          <span className="self-center text-xs text-destructive">File unavailable</span>
        )}
        {destination ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={destination}>Open related record</Link>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function EmailCard({ document }: { document: BossEmailDocument }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-foreground">{document.subject}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            To {document.contactName || document.recipientEmail} · {document.organizationName}
          </p>
        </div>
        <Badge variant={document.state === "needs_changes" ? "destructive" : document.state === "sent" ? "default" : "secondary"}>
          {label(document.state)}
        </Badge>
      </div>
      {document.ownerReturnNote ? (
        <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-foreground">{document.ownerReturnNote}</p>
      ) : document.coordinatorNote ? (
        <p className="mt-3 text-sm text-muted-foreground">{document.coordinatorNote}</p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Updated {dateLabel(document.updatedAt)}</span>
        <Button asChild size="sm" variant="ghost">
          <Link href={`/boss/contacts/${document.organizationId}`}>Open profile</Link>
        </Button>
      </div>
    </article>
  );
}

export default function BossTemplatesFilesPage() {
  const [data, setData] = useState<BossDocumentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await bossDocumentsApi.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load business documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="grid gap-7" data-testid="boss-business-documents-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Business Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">Contracts, certificates of insurance, and operational emails.</p>
        </div>
         <div className="flex gap-2">
           <Button asChild size="sm"><Link href="/boss/coi">Manage COIs</Link></Button>
           <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>
             <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
           </Button>
         </div>
      </header>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void load()} variant="outline" size="sm">Try again</Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} className="h-36 rounded-xl" />)}
        </div>
      ) : data && !data.workspaceAvailable ? (
        <Empty icon={<AlertTriangle className="h-7 w-7" />} title="Document workspace unavailable">
          Ask Desie to connect this Boss account to an Office workspace.
        </Empty>
      ) : data ? (
        <>
          <section className="grid gap-3">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Contracts</h2>
              <Badge variant="outline">{data.contracts.length}</Badge>
            </div>
            {data.contracts.length ? (
              <div className="grid gap-3 md:grid-cols-2">{data.contracts.map((item) => <ContractCard key={item.id} document={item} />)}</div>
            ) : (
              <Empty icon={<FileText className="h-7 w-7" />} title="No prepared contracts">
                Contract projects prepared in Design Studio will appear here.
              </Empty>
            )}
          </section>

          <section className="grid gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Certificates of Insurance</h2>
              <Badge variant="outline">{data.certificates.length}</Badge>
            </div>
            {data.certificates.length ? (
              <div className="grid gap-3 md:grid-cols-2">{data.certificates.map((item) => <CertificateCard key={item.id} document={item} />)}</div>
            ) : (
              <Empty icon={<FileText className="h-7 w-7" />} title="No COI files connected">
                Event or profile Studio assets labeled COI or certificate of insurance will appear here.
              </Empty>
            )}
          </section>

          <section className="grid gap-3">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Operational Emails</h2>
              <Badge variant="outline">{data.emailDrafts.length}</Badge>
            </div>
            {data.emailDrafts.length ? (
              <div className="grid gap-3 md:grid-cols-2">{data.emailDrafts.map((item) => <EmailCard key={item.id} document={item} />)}</div>
            ) : (
              <Empty icon={<Mail className="h-7 w-7" />} title="No operational email drafts">
                Drafts from the connected Office workspace will appear here for review.
              </Empty>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}