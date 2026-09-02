import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";

import { createActivityAction, editActivityAction, listActivityRevisionsAction } from "@/actions/activities";
import { completeCallAction } from "@/actions/calls";
import { AssistantContextRegistration } from "@/components/assistant/assistant-context-registration";
import { AssistedCallingUnavailable } from "@/components/calls/assisted-calling-unavailable";
import { CallAssistantPanel } from "@/components/calls/call-assistant-panel";
import { CallerFinder } from "@/components/calls/caller-finder";
import { CallWorkspace } from "@/components/calls/call-workspace";
import type { ComputerCallingCapability } from "@/components/calls/phone-actions";
import { QuickAddCaller, type QuickAddCallerSubmission } from "@/components/contacts/quick-add-caller";
import { GuidedCallScriptOverridesProvider } from "@/features/calls/guided-call-script-settings-context";
import { apiGet, apiPost } from "@/lib/auth-token";

function toDate(value: unknown): Date | null {
  return value ? new Date(value as string) : null;
}

function coerceTimeline(items: any[]): any[] {
  return (items ?? []).map((item) => ({
    ...item,
    occurredAt: item.occurredAt ? new Date(item.occurredAt) : item.occurredAt,
    createdAt: item.createdAt ? new Date(item.createdAt) : item.createdAt,
    updatedAt: item.updatedAt ? new Date(item.updatedAt) : item.updatedAt,
  }));
}

type CallingConfig = {
  assistedCallingEnabled: boolean;
  voicemailLauncherUrl: string | null;
  computerCalling: ComputerCallingCapability;
};

const disabledComputerCalling: ComputerCallingCapability = {
  enabled: false,
  reason: "disabled",
  callerIdDisplay: null,
};

type QuickAddResult =
  | { ok: true; contactId: string }
  | { ok: false; error: string }
  | { ok: false; canContinueCreating: boolean; candidates: Array<{
      contactId: string;
      name: string;
      organizationName: string | null;
      city: string | null;
      region: string | null;
      reasons: string[];
      kind: "exact" | "likely";
    }> };

export default function CallWorkspacePage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const followUpId = params.get("followUpId") ?? undefined;
  const bookingId = params.get("bookingId") ?? undefined;
  const contactId = params.get("contactId") ?? undefined;
  const organizationId = params.get("organizationId") ?? undefined;
  const addMode = params.get("mode") === "add";
  const initialPhone = params.get("phone") ?? "";
  const initialQuery = params.get("q") ?? "";
  const hasContext = Boolean(followUpId || bookingId || contactId || organizationId);

  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<CallingConfig>({
    assistedCallingEnabled: false,
    voicemailLauncherUrl: null,
    computerCalling: disabledComputerCalling,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectCaller = useCallback((selectedContactId: string) => {
    const query = new URLSearchParams({ contactId: selectedContactId });
    setLocation(`/calls/workspace?${query.toString()}`);
  }, [setLocation]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (followUpId) query.set("followUpId", followUpId);
    if (bookingId) query.set("bookingId", bookingId);
    if (contactId) query.set("contactId", contactId);
    if (organizationId) query.set("organizationId", organizationId);

    setLoading(true);
    setError(null);
    apiGet<CallingConfig>("/calls/config").catch(() => ({
        assistedCallingEnabled: false,
        voicemailLauncherUrl: null,
        computerCalling: disabledComputerCalling,
      }))
      .then(async (callingConfig) => {
        setConfig(callingConfig);
        if (!callingConfig.assistedCallingEnabled || !hasContext) {
          setData(null);
          setLoading(false);
          return;
        }
        const workspace = await apiGet<any>(`/calls/workspace?${query.toString()}`);
        setData(workspace);
        setLoading(false);
      })
      .catch((reason) => {
        setError(reason.message);
        setLoading(false);
      });
  }, [search, hasContext]);

  if (loading) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-slate-500">Loading call workspace…</p></div>;
  if (!config.assistedCallingEnabled) return <AssistedCallingUnavailable />;
  if (!hasContext) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        {addMode ? (
          <QuickAddCaller
            initialPhone={initialPhone}
            initialQuery={initialQuery}
            onSubmit={(input: QuickAddCallerSubmission) => apiPost<QuickAddResult>("/calls/quick-caller", input)}
          />
        ) : (
          <CallerFinder initialPhone={initialPhone} onSelect={selectCaller} />
        )}
      </div>
    );
  }
  if (error || !data) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  const context = data.context ?? {};
  const booking = context.booking
    ? { ...context.booking, startsAt: toDate(context.booking.startsAt) }
    : null;
  const contact = context.contact
    ? {
        id: context.contact.id,
        name: context.contact.name ?? `${context.contact.firstName ?? ""} ${context.contact.lastName ?? ""}`.trim(),
        phone: context.contact.phone ?? null,
        email: context.contact.email ?? null,
        city: context.contact.city ?? null,
        region: context.contact.region ?? null,
      }
    : null;
  const followUp = context.followUp
    ? { ...context.followUp, dueAt: new Date(context.followUp.dueAt) }
    : null;
  const organization = context.organization ?? null;

  const assistantContext = booking?.id
    ? { kind: "booking" as const, recordId: booking.id, label: booking.name ?? "Booking" }
    : organization?.id
      ? { kind: "organization" as const, recordId: organization.id, label: organization.name ?? "Profile" }
      : contact?.id
        ? { kind: "contact" as const, recordId: contact.id, label: contact.name ?? "Contact" }
        : null;

  return (
    <div className="mx-auto grid max-w-7xl gap-5">
      {assistantContext ? <AssistantContextRegistration {...assistantContext} /> : null}
      <GuidedCallScriptOverridesProvider overrides={data.guidedScriptOverrides ?? []}>
        <CallWorkspace
          activityParent={data.activityParent}
          assistedCallingEnabled={config.assistedCallingEnabled}
          booking={booking}
          briefing={data.briefing ?? null}
          contact={contact}
          computerCalling={config.computerCalling}
          contextSummary={data.contextSummary ?? null}
          createActivity={createActivityAction}
          defaultScriptKind={data.defaultScriptKind}
          editActivity={editActivityAction}
          followUp={followUp}
          loadRevisions={listActivityRevisionsAction}
          mode="full"
          onComplete={completeCallAction}
          operations={data.operations ?? null}
          organization={organization}
          phones={data.phones ?? []}
          recommendedGuidedScriptKind={data.recommendedGuidedScriptKind ?? null}
          scriptPrompts={data.scriptPrompts ?? []}
          timeline={coerceTimeline(data.timeline)}
          voicemailLauncherUrl={config.voicemailLauncherUrl}
        />
      </GuidedCallScriptOverridesProvider>
      <CallAssistantPanel
        bookingId={booking?.id ?? null}
        contactId={contact?.id ?? null}
        followUpId={followUp?.id ?? null}
        organizationId={organization?.id ?? null}
      />
    </div>
  );
}
