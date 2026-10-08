import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { ProfileAtAGlance } from "./_shared/ProfileAtAGlance";

const currentProfile = {
  place: {
    name: "Riverfront Arts Festival",
    applicationDeadline: "2027-02-01",
    recommendedDealModel: "flat_fee" as const,
  },
  contacts: [
    {
      id: "jordan-avery",
      name: "Jordan Avery",
      isPrimary: true,
      email: "jordan@riverfrontarts.example",
      phone: "(303) 555-0146",
    },
  ],
  bookings: [
    {
      id: "riverfront-2026",
      startsAt: "2026-08-22T12:00:00Z",
      status: "confirmed",
    },
  ],
  effectiveEventDate: {
    startsOn: "2026-08-22",
    endsOn: "2026-08-23",
    displayStatus: "confirmed" as const,
    sourceId: "riverfront-2026",
  },
  eventDateFacts: [],
  followUps: [],
  notes: [
    {
      id: "current-note",
      kind: "note",
      body: "Jordan asked us to reconnect after the committee reviews the 2027 schedule.",
      occurredAt: "2026-07-18T16:00:00Z",
    },
  ],
  decisionSummary: {
    priority: "normal",
    pipelineStatus: "confirmed",
    nextActionKind: "follow_up",
    nextActionDueAt: "2026-09-15T12:00:00Z",
  },
};

export function CurrentProfileFacts() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground sm:p-10">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header className="grid gap-2 border-b border-border pb-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-muted-foreground">Existing profile section</p>
            <Badge variant="outline">Current CRM</Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Riverfront Arts Festival</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            This reference uses the profile facts component from the current app. The redesign keeps these records and adds optional festival-edition information.
          </p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>At a glance</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileAtAGlance profile={currentProfile} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Already tracked on the profile</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="font-semibold">Organizer and contacts</p>
              <p className="mt-1 text-muted-foreground">Primary contact details and contact roles.</p>
            </div>
            <div>
              <p className="font-semibold">Bookings and event dates</p>
              <p className="mt-1 text-muted-foreground">Recorded dates stay connected to the organizer.</p>
            </div>
            <div>
              <p className="font-semibold">Follow-up and history</p>
              <p className="mt-1 text-muted-foreground">Notes and next actions remain part of the profile.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
