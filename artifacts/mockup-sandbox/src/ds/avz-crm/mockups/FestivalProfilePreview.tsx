import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/avz-crm/components/ui/accordion";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/avz-crm/components/ui/card";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";

type Edition = {
  year: string;
  status: string;
  dates: string;
  deadline: string;
  hours: string;
  venue: string;
  setting: string;
  category: string;
  attendance: string;
  editionHistory: string;
  exhibitors: string;
  juried: string;
  boothFee: string;
  application: string;
  prizes: string;
  categories: string;
  insurance: string;
  restrictions: string;
  food: string;
  performances: string;
  activities: string;
  admission: string;
  description: string;
  photos: string;
  visitorFaq: Array<[string, string]>;
};

const editions: Edition[] = [
  {
    year: "2027",
    status: "Planning",
    dates: "Aug 21–22, 2027 · Proposed",
    deadline: "Feb 1, 2027",
    hours: "Sat 10 AM–7 PM · Sun 10 AM–5 PM",
    venue: "Riverfront Commons, 100 Water Street, Fort Collins, CO",
    setting: "Outdoor riverside lawns with indoor rain backup in the Pavilion",
    category: "Fine art & community festival",
    attendance: "Approx. 18,000 visitors · 40th annual edition",
    editionHistory: "First held in 1988; annual except 2020. Last event: Aug 22–23, 2026.",
    exhibitors: "145 booths · Juried by a 5-person artist panel",
    juried: "Jury results emailed Mar 12; images required with application",
    boothFee: "$325 standard · $475 corner · 10 × 10 ft space",
    application: "Apply online by Feb 1. 50% deposit due on acceptance; balance due Jun 1.",
    prizes: "Best in Show $1,000 · 2 merit awards at $500 each",
    categories: "Painting, ceramics, jewelry, glass, fiber, photography, sculpture, wood",
    insurance: "$1M general liability certificate required by Jul 15",
    restrictions: "100% handmade original work; no buy/sell, resale, or generative-AI-only work",
    food: "12 food booths and 4 food trucks; booth $650, truck $850. Application due Mar 1; health permit and $1M liability certificate required.",
    performances: "Two stages · Community acts unpaid; headline sets have negotiated fees. Performance applications due Apr 15.",
    activities: "Children's art tent, river ecology walk, and live demonstrations",
    admission: "Free admission; donations support the arts education fund",
    description: "A juried celebration of regional art, river culture, and live music, produced by the Riverfront Cultural Association.",
    photos: "2026 recap gallery: 18 approved event photos · 2027 poster: in progress",
    visitorFaq: [
      ["Weather", "The festival runs rain or shine. Pavilion activities move indoors for severe weather."],
      ["Pets", "Leashed pets are welcome outdoors; service animals are welcome in all spaces."],
      ["Accessibility", "Paved routes, accessible restrooms, and a drop-off point at the east entrance."],
      ["Age & child prices", "All ages welcome. Admission is free for children and adults."],
    ],
  },
  {
    year: "2026",
    status: "Confirmed · booked",
    dates: "Aug 22–23, 2026 · Confirmed",
    deadline: "Feb 1, 2026",
    hours: "Sat 10 AM–7 PM · Sun 10 AM–5 PM",
    venue: "Riverfront Commons, 100 Water Street, Fort Collins, CO",
    setting: "Outdoor riverside lawns with indoor rain backup in the Pavilion",
    category: "Fine art & community festival",
    attendance: "Approx. 17,500 visitors · 39th annual edition",
    editionHistory: "Held annually since 1988, with a pause in 2020.",
    exhibitors: "138 booths · Juried by a 5-person artist panel",
    juried: "Jury results sent Mar 10; images required with application",
    boothFee: "$310 standard · $450 corner · 10 × 10 ft space",
    application: "Online application closed Feb 1. Accepted artists paid a 50% deposit.",
    prizes: "Best in Show $900 · 2 merit awards at $450 each",
    categories: "Painting, ceramics, jewelry, glass, fiber, photography, sculpture, wood",
    insurance: "$1M general liability certificate required",
    restrictions: "Original work only; no buy/sell or resale products",
    food: "10 food booths and 4 food trucks; booth $625, truck $825. Application and health permit required.",
    performances: "Two stages · Community acts unpaid; headline sets have negotiated fees.",
    activities: "Children's art tent, river ecology walk, and live demonstrations",
    admission: "Free admission; donations support arts education",
    description: "A juried celebration of regional art, river culture, and live music.",
    photos: "2026 recap gallery: 18 approved event photos",
    visitorFaq: [
      ["Weather", "Rain or shine; Pavilion is the severe-weather backup."],
      ["Pets", "Leashed pets welcome outdoors; service animals throughout."],
      ["Accessibility", "Paved paths and accessible restrooms; east entrance drop-off."],
      ["Age & child prices", "All ages welcome; admission is free for every age."],
    ],
  },
];

const roles = [
  { role: "Show / organizer", name: "Jordan Avery", email: "jordan@riverfrontarts.example", phone: "(303) 555-0146" },
  { role: "Exhibits", name: "Lena Ortiz", email: "lena@riverfrontarts.example", phone: "(303) 555-0178" },
  { role: "Food vendors", name: "Devon Price", email: "food@riverfrontarts.example", phone: "(303) 555-0194" },
  { role: "Entertainment", name: "Mara Chen", email: "mara@riverfrontarts.example", phone: "(303) 555-0122" },
];

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-6">{children}</dd>
    </div>
  );
}

function FactGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>;
}

export function FestivalProfilePreview() {
  const [year, setYear] = useState("2027");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpSaved, setFollowUpSaved] = useState(false);
  const [followUpNote, setFollowUpNote] = useState("Reconnect after the committee reviews the 2027 schedule.");
  const selectedEdition = editions.find((edition) => edition.year === year) ?? editions[0]!;

  function addFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFollowUpSaved(true);
    setFollowUpOpen(false);
  }

  return (
    <main className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto grid max-w-6xl gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="font-display text-xs font-bold uppercase tracking-wide text-primary">Adventure Zone · Organizer profile</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Riverfront Arts Festival</h1>
            <p className="mt-1 text-sm text-muted-foreground">Fort Collins, Colorado · Riverfront Cultural Association</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Active relationship</Badge>
            <Badge variant="outline">4.8 · 32 reviews</Badge>
          </div>
        </header>

        <Alert>
          <AlertTitle>Prototype preview</AlertTitle>
          <AlertDescription>Edition selection and follow-up actions are local previews. Changes are not saved to the CRM.</AlertDescription>
        </Alert>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.9fr)]">
          <section className="grid content-start gap-4" aria-label="Festival edition details">
            <Card>
              <CardHeader className="flex-col items-stretch gap-3 space-y-0 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Festival edition</p>
                  <CardTitle className="mt-1">{selectedEdition.year} event record</CardTitle>
                </div>
                <div className="grid w-full gap-1 sm:w-52">
                  <Label htmlFor="profile-edition">Choose year</Label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger id="profile-edition" aria-label="Choose festival year">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editions.map((edition) => <SelectItem key={edition.year} value={edition.year}>{edition.year} · {edition.status}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 rounded-md border border-border bg-muted p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event dates · {selectedEdition.year}</p>
                    <p className="mt-1 font-semibold">{selectedEdition.dates}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedEdition.hours}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Application deadline · {selectedEdition.year}</p>
                    <p className="mt-1 font-semibold">{selectedEdition.deadline}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedEdition.status}</p>
                  </div>
                </div>
                <FactGrid>
                  <Fact label="Venue & setting">{selectedEdition.venue} · {selectedEdition.setting}</Fact>
                  <Fact label="Category & attendance">{selectedEdition.category} · {selectedEdition.attendance}</Fact>
                </FactGrid>
                <Accordion type="multiple" className="w-full">
                  <AccordionItem value="artists">
                    <AccordionTrigger>Artist exhibitors &amp; applications</AccordionTrigger>
                    <AccordionContent>
                      <FactGrid>
                        <Fact label="Exhibitors & juried status">{selectedEdition.exhibitors}. {selectedEdition.juried}.</Fact>
                        <Fact label="Booth fees">{selectedEdition.boothFee}</Fact>
                        <Fact label="Application terms">{selectedEdition.application}</Fact>
                        <Fact label="Prizes">{selectedEdition.prizes}</Fact>
                        <Fact label="Accepted categories">{selectedEdition.categories}</Fact>
                        <Fact label="Insurance & restrictions">{selectedEdition.insurance}. {selectedEdition.restrictions}.</Fact>
                      </FactGrid>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="food">
                    <AccordionTrigger>Food vendors &amp; trucks</AccordionTrigger>
                    <AccordionContent>
                      <FactGrid><Fact label="Food applications">{selectedEdition.food}</Fact></FactGrid>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="program">
                    <AccordionTrigger>Performances, activities &amp; admission</AccordionTrigger>
                    <AccordionContent>
                      <FactGrid>
                        <Fact label="Stages & performer terms">{selectedEdition.performances}</Fact>
                        <Fact label="Activities">{selectedEdition.activities}</Fact>
                        <Fact label="Admission">{selectedEdition.admission}</Fact>
                        <Fact label="Edition history">{selectedEdition.editionHistory}</Fact>
                      </FactGrid>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="visitors">
                    <AccordionTrigger>Event description, images &amp; visitor FAQs</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid gap-4">
                        <FactGrid>
                          <Fact label="Description">{selectedEdition.description}</Fact>
                          <Fact label="Images & promotional material">{selectedEdition.photos}</Fact>
                        </FactGrid>
                        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                          {selectedEdition.visitorFaq.map(([question, answer]) => (
                            <div key={question}>
                              <p className="text-xs font-semibold text-muted-foreground">{question}</p>
                              <p className="mt-1 text-sm leading-6">{answer}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>

            <Accordion type="multiple" className="rounded-md border border-border bg-card px-4">
              <AccordionItem value="organizer">
                <AccordionTrigger>Organizer record &amp; contact roles</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4">
                    <FactGrid>
                      <Fact label="Organization group">Riverfront Cultural Association</Fact>
                      <Fact label="Mailing address">100 Water Street, Fort Collins, CO 80524</Fact>
                      <Fact label="Office phone">(303) 555-0146</Fact>
                      <Fact label="Email">jordan@riverfrontarts.example</Fact>
                      <Fact label="Website">riverfrontarts.example</Fact>
                      <Fact label="Recommended deal model">Flat fee · Guaranteed appearance amount</Fact>
                    </FactGrid>
                    <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                      {roles.map((contact) => (
                        <div className="rounded-md border border-border p-3" key={contact.role}>
                          <p className="text-xs font-semibold text-muted-foreground">{contact.role}</p>
                          <p className="mt-1 font-semibold">{contact.name}</p>
                          <p className="mt-1 break-all text-sm">{contact.email}</p>
                          <p className="text-sm text-muted-foreground">{contact.phone}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="history">
                <AccordionTrigger>Bookings, follow-ups &amp; relationship history</AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4">
                    <FactGrid>
                      <Fact label="Existing event booking">Riverfront Arts Festival · Aug 22–23, 2026 · Confirmed booking</Fact>
                      <Fact label="Next action">{followUpSaved ? "Local preview follow-up prepared · reconnect after committee review" : "Follow up with Jordan · Sep 15, 2026"}</Fact>
                      <Fact label="Recent note">Jordan asked us to reconnect after the committee reviews the 2027 schedule.</Fact>
                      <Fact label="Email history">Jordan’s 2027 planning thread · Last email Jul 18, 2026 · 3 messages</Fact>
                      <Fact label="Documents">2026 booking agreement · Certificate of insurance · 2026 event brief</Fact>
                      <Fact label="Reviews">4.8 / 5 from 32 reviews · Last reviewed after the 2026 festival</Fact>
                    </FactGrid>
                    <div className="border-t border-border pt-3">
                      <p className="text-xs font-semibold text-muted-foreground">Event relationship context</p>
                      <p className="mt-1 text-sm leading-6">39 completed editions before 2027; confirmed Adventure Zone booking in 2026. The selected-year application dates belong to the edition record, not the organizer.</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>

          <aside className="grid content-start gap-4" aria-label="Next action and profile summary">
            <Card>
              <CardHeader>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next action</p>
                <CardTitle>Reconnect with Jordan</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm leading-6 text-muted-foreground">The committee is reviewing the 2027 schedule. Follow up with the show organizer when their review is complete.</p>
                <Badge variant={followUpSaved ? "secondary" : "outline"}>{followUpSaved ? "Preview follow-up ready" : "Due Sep 15, 2026"}</Badge>
                {followUpSaved ? <p className="text-sm" role="status">Follow-up preview prepared. Nothing was sent or saved to the CRM.</p> : null}
                {followUpOpen ? (
                  <form className="grid gap-3 border-t border-border pt-3" onSubmit={addFollowUp}>
                    <div className="grid gap-1">
                      <Label htmlFor="follow-up-date">Reminder date</Label>
                      <Input id="follow-up-date" type="date" defaultValue="2026-09-15" required />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="follow-up-note">Follow-up note</Label>
                      <Textarea id="follow-up-note" value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} required />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm">Prepare preview</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setFollowUpOpen(false)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <Button className="w-fit" onClick={() => setFollowUpOpen(true)}>Log follow-up</Button>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Organizer at a glance</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div>
                  <p className="font-semibold">Jordan Avery</p>
                  <p className="text-sm text-muted-foreground">Show organizer · Primary contact</p>
                </div>
                <p className="break-all text-sm">jordan@riverfrontarts.example</p>
                <p className="text-sm">(303) 555-0146</p>
                <p className="text-sm text-muted-foreground">Riverfront Cultural Association · Fort Collins, CO</p>
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Booking history</p>
                  <p className="mt-1 text-sm">Aug 22–23, 2026 · Confirmed</p>
                  <p className="text-sm text-muted-foreground">2027 edition · Planning record selected</p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </main>
  );
}
