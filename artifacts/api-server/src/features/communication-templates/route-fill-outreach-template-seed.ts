import type { db as database } from "@/db/client";
import { CommunicationTemplateRepository } from "./communication-template-repository";
import type { CommunicationTemplateSeed } from "./communication-template-types";

export const ROUTE_FILL_OUTREACH_TEMPLATE_SEEDS = [
  {
    code: "route_fill_outreach",
    name: "Route fill / nearby event outreach",
    channel: "email",
    category: "outreach",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Possible family-fun addition for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "packagePrice", "senderName"],
    bodyTemplate: `Hello {{contactName}},

My name is {{senderName}}, and I’m reaching out on behalf of The Adventure Zone, a family-owned bounce house carnival that brings a full inflatable fun area to fairs, festivals, and community events.

We’re currently routing one of our traveling teams through your region around the time of {{eventName}}, and I wanted to reach out in case you still have room for an additional family attraction at your event.

Our exact lineup can vary by traveling team and equipment availability, but we bring a full family-fun area with a mix of attractions for children, families, teens, and adults. Depending on the route, that can include water slides, obstacle courses, large slides, inflatable mazes, bounce houses, and other activity attractions. Together, they create a much larger family area than just one or two individual bounce houses.

Our preferred arrangement is a {{packagePrice}} prepaid package. With that option, we bring in and operate the attractions, and your event is able to offer them free to attendees.

If we’re reaching out close to the event date or already traveling through the surrounding area, we may also be able to consider a pay-per-play arrangement. With that option, guests pay to participate and an agreed percentage of gross ticket sales goes back to the event. Any pay-per-play terms would be confirmed before the arrangement is promised.

For the setup, we would mainly need:

- A suitable area for the attractions
- Access to sufficient electrical power
- Water access if water attractions are used
- Room for our trailers and equipment during setup and removal
- A place on or near the grounds for our team’s RV, if available

Do you currently have another inflatable or bounce-house provider contracted for {{eventName}}?

If not, we would love to talk with you about whether the {{packagePrice}} prepaid package — or, when appropriate, a pay-per-play arrangement — could work for your event.

You can learn more about The Adventure Zone here:
https://www.the-adventure-zone.com/general-5

Thank you,

{{senderName}}
The Adventure Zone
{{senderPhone}}
{{senderEmail}}`,
  },
] as const satisfies readonly CommunicationTemplateSeed[];

type Database = typeof database;

export async function ensureRouteFillOutreachTemplateSeed(
  database: Database,
): Promise<void> {
  await new CommunicationTemplateRepository(database).seed(
    ROUTE_FILL_OUTREACH_TEMPLATE_SEEDS,
    null,
  );
}
