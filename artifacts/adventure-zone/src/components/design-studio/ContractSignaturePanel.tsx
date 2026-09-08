import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileSignature, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import {
  designStudioApi,
  type ContractAgreement,
  type ContractReadiness,
} from "@/lib/design-studio-api";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ContractSignaturePanel({ projectId, dirty, onSave }: {
  projectId: string;
  dirty: boolean;
  onSave: () => Promise<boolean>;
}) {
  const [agreement, setAgreement] = useState<ContractAgreement | null>(null);
  const [readiness, setReadiness] = useState<ContractReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await designStudioApi.contractState(projectId);
    setAgreement(result.agreements[0] ?? null);
    setReadiness(result.readiness);
  }, [projectId]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Contract status is unavailable.")); }, [load]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Contract action failed."); }
    finally { setBusy(false); }
  }

  async function prepare() {
    if (dirty && !(await onSave())) return;
    await act(() => designStudioApi.prepareContract(projectId));
  }

  const terminal = agreement && ["completed", "declined", "cancelled", "expired", "replaced"].includes(agreement.state);
  return (
    <section className="mx-3 mt-3 rounded-xl border border-border bg-card p-4" aria-label="Acrobat Sign workflow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            <h2 className="font-bold">Acrobat Sign</h2>
            {agreement ? <Badge variant={agreement.state === "completed" ? "default" : "secondary"}>{label(agreement.state)}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {agreement
              ? `${agreement.customerName} signs first; ${agreement.davidName} countersigns second.`
              : "Review the contract, then freeze an immutable PDF for signature."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!agreement ? <Button disabled={busy} onClick={() => void prepare()}>Prepare for signature</Button> : null}
          {agreement?.state === "ready" || agreement?.state === "failed" ? (
            <Button disabled={busy || !readiness?.signApiAvailable} onClick={() => void act(() => designStudioApi.sendContract(agreement.id))}>
              Send customer first
            </Button>
          ) : null}
          {agreement?.providerAgreementId && !terminal ? (
            <Button disabled={busy} variant="outline" onClick={() => void act(() => designStudioApi.refreshContract(agreement.id))}>
              <RefreshCw className="mr-2 h-4 w-4" />Refresh from Adobe
            </Button>
          ) : null}
          {agreement?.signedPdfAvailable ? <Button variant="outline" onClick={() => void designStudioApi.contractFile(agreement.id, "signed")}>Signed PDF</Button> : null}
          {agreement?.auditTrailAvailable ? <Button variant="outline" onClick={() => void designStudioApi.contractFile(agreement.id, "audit")}>Audit trail</Button> : null}
        </div>
      </div>
      {readiness && !readiness.signApiAvailable ? (
        <div className="mt-3 flex gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Drafting is available; sending is not configured.</strong> Acrobat Pro alone does not enable the Sign API. {readiness.reason}</p>
        </div>
      ) : readiness?.signApiAvailable ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-primary" />Acrobat Sign API configuration is present.</div>
      ) : null}
      {agreement?.customerSignedAt && agreement.state !== "completed" ? <p className="mt-3 text-sm text-muted-foreground">Customer signature confirmed by Adobe. Waiting for David.</p> : null}
      {agreement?.failureDetails ? <p className="mt-3 text-sm text-destructive">{agreement.failureDetails}</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}