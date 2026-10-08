import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@workspace/avz-crm/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";

type Lead = {
  id: string;
  organization: string;
  contact: string;
  role: string;
  city: string;
  region: string;
  date: string;
  followUp: string;
  nextAction: string;
  suggestedLeg: string;
  legReason: string;
  lastContact: string;
};

const leads: Lead[] = [
  {
    id: "pine",
    organization: "Pine County Festival",
    contact: "Avery Cole",
    role: "Event coordinator",
    city: "Stillwater",
    region: "MN",
    date: "Aug 7–8, 2027 · estimated",
    followUp: "No reminder scheduled",
    nextAction: "Reply to the new inquiry and confirm 2027 dates",
    suggestedLeg: "north",
    legReason: "Prior-year festival dates and location align with the North Route.",
    lastContact: "New inquiry · Jun 16",
  },
  {
    id: "riverside",
    organization: "Riverside Arts Festival",
    contact: "Morgan Bell",
    role: "Festival director",
    city: "Hudson",
    region: "WI",
    date: "Sep 12–13, 2025 · past event",
    followUp: "Post-event follow-up · due today",
    nextAction: "Check in after the event and ask about next season",
    suggestedLeg: "central",
    legReason: "Hudson, WI connects naturally with the Central Circuit.",
    lastContact: "Proposal sent · Jun 9",
  },
];

const travelLegs = [
  { id: "north", name: "North Route" },
  { id: "central", name: "Central Circuit" },
  { id: "coastal", name: "Coastal Loop" },
];

function legName(id: string | null) {
  return travelLegs.find((leg) => leg.id === id)?.name ?? "Choose a leg";
}

export function LeadsPreview() {
  const [selectedId, setSelectedId] = useState(leads[0]!.id);
  const [assignedLegs, setAssignedLegs] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftMessage, setDraftMessage] = useState("Could you confirm the festival dates and availability for 2027?");
  const [prepared, setPrepared] = useState(false);
  const selectedLead = leads.find((lead) => lead.id === selectedId) ?? leads[0]!;
  const chosenLeg = assignedLegs[selectedLead.id] ?? "";
  const displayLeg = chosenLeg || selectedLead.suggestedLeg;
  const hasOverride = Boolean(chosenLeg && chosenLeg !== selectedLead.suggestedLeg);

  function selectLead(id: string) {
    setSelectedId(id);
    setFeedback(null);
    setDraftOpen(false);
    setPrepared(false);
  }

  function useSuggestedLeg() {
    setAssignedLegs((current) => ({ ...current, [selectedLead.id]: selectedLead.suggestedLeg }));
    setFeedback(`${legName(selectedLead.suggestedLeg)} shown as the selected leg for this preview.`);
  }

  function chooseLeg(id: string) {
    setAssignedLegs((current) => ({ ...current, [selectedLead.id]: id }));
    setFeedback(`${legName(id)} shown as your override for this preview.`);
  }

  function prepareFollowUp() {
    setPrepared(true);
    setDraftOpen(false);
  }

  return (
    <main className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto grid max-w-6xl gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">Adventure Zone · Leads</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Lead work queue</h1>
            <p className="mt-1 text-sm text-muted-foreground">One queue, with the selected lead’s next step alongside it.</p>
          </div>
          <Badge variant="secondary">{leads.length} needs attention</Badge>
        </header>

        <Alert>
          <AlertTitle>Prototype preview</AlertTitle>
          <AlertDescription>Lead selection, follow-up preparation, and leg choices are local previews only. Changes are not saved to the CRM.</AlertDescription>
        </Alert>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.95fr)]">
          <section className="grid gap-3" aria-label="Lead work queue">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold">Needs a next step</h2>
              <p className="text-sm text-muted-foreground">Select one lead to work</p>
            </div>
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Open leads</CardTitle>
                <Badge variant="outline">{leads.length} records</Badge>
              </CardHeader>
              <CardContent>
                <RadioGroup aria-label="Select a lead" className="gap-0" onValueChange={selectLead} value={selectedId}>
                  {leads.map((lead) => {
                    const active = selectedId === lead.id;
                    const rowLeg = assignedLegs[lead.id] ?? lead.suggestedLeg;
                    const rowHasOverride = Boolean(assignedLegs[lead.id] && assignedLegs[lead.id] !== lead.suggestedLeg);
                    return (
                      <div className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 border-t border-border py-4 ${active ? "bg-muted" : ""}`} key={lead.id}>
                        <RadioGroupItem className="mt-1" id={`lead-${lead.id}`} value={lead.id} />
                        <Label className="grid min-w-0 cursor-pointer gap-2" htmlFor={`lead-${lead.id}`}>
                          <span className="flex flex-wrap items-start justify-between gap-2">
                            <span className="font-semibold">{lead.organization}</span>
                            <Badge variant={active ? "secondary" : "outline"}>{lead.followUp}</Badge>
                          </span>
                          <span className="text-sm text-muted-foreground">{lead.contact} · {lead.role}</span>
                          <span className="text-sm">{lead.city}, {lead.region} · {lead.date}</span>
                          <span className="text-sm text-muted-foreground">Next: {lead.nextAction}</span>
                          <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-primary">
                            Suggested leg: {legName(lead.suggestedLeg)}
                            {rowHasOverride ? <Badge variant="outline">Override: {legName(rowLeg)}</Badge> : null}
                          </span>
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">Suggested routes are planning aids. Booking assignment remains in the booking workflow.</p>
          </section>

          <section className="grid gap-3" aria-label="Selected lead next action">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">Next action</h2>
              <Badge variant="outline">Selected lead</Badge>
            </div>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle>{selectedLead.organization}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedLead.city}, {selectedLead.region} · {selectedLead.date}</p>
                  </div>
                  <Badge variant="secondary">{selectedLead.followUp}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="rounded-md border border-border bg-muted p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended follow-up</p>
                  <p className="mt-1 font-semibold">{selectedLead.nextAction}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Contact: {selectedLead.contact} · {selectedLead.role} · {selectedLead.lastContact}</p>
                  {prepared ? <p className="mt-3 text-sm font-semibold" role="status">Follow-up draft prepared locally. Nothing was sent or saved.</p> : null}
                  {draftOpen ? (
                    <div className="mt-4 grid gap-2 border-t border-border pt-4">
                      <Label htmlFor="lead-draft">Draft message</Label>
                      <Textarea id="lead-draft" value={draftMessage} onChange={(event) => setDraftMessage(event.target.value)} />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={prepareFollowUp}>Prepare draft</Button>
                        <Button size="sm" variant="outline" onClick={() => setDraftOpen(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button className="mt-4" onClick={() => setDraftOpen(true)}>{prepared ? "Revise draft" : "Prepare follow-up"}</Button>
                  )}
                </div>

                <div className="grid gap-3 rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">Suggested travel leg</p>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedLead.legReason}</p>
                    </div>
                    <Badge variant={hasOverride ? "outline" : "secondary"}>{hasOverride ? "Override selected" : "Suggested"}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended</p>
                      <p className="mt-1 font-semibold">{legName(selectedLead.suggestedLeg)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected for preview</p>
                      <p className="mt-1 font-semibold">{legName(displayLeg)}</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
                    <Button size="sm" variant="outline" onClick={useSuggestedLeg}>Use suggested leg</Button>
                    <div className="grid gap-1">
                      <Label htmlFor="lead-leg-override">Or choose another leg</Label>
                      <Select value={displayLeg} onValueChange={chooseLeg}>
                        <SelectTrigger id="lead-leg-override" aria-label="Choose another travel leg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {travelLegs.map((leg) => <SelectItem key={leg.id} value={leg.id}>{leg.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {feedback ? <p className="text-sm font-semibold" role="status">{feedback}</p> : null}
                  <p className="text-xs text-muted-foreground">Local preview only. This lead page does not change or reassign a booking.</p>
                </div>

                <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organization &amp; contact</p>
                    <p className="mt-1 text-sm font-semibold">{selectedLead.organization}</p>
                    <p className="text-sm text-muted-foreground">{selectedLead.contact} · {selectedLead.role}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Place &amp; date</p>
                    <p className="mt-1 text-sm">{selectedLead.city}, {selectedLead.region}</p>
                    <p className="text-sm text-muted-foreground">{selectedLead.date}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
