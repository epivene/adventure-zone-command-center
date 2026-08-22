import { eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { businessSourceDocuments } from "@/db/schema";
import type { CommunicationTemplateSeed } from "./communication-template-types";
import { CommunicationTemplateRepository } from "./communication-template-repository";
import { ensureBusinessSourceSeed } from "@/features/business-sources/business-source-seed";

export const COMMUNICATION_TEMPLATE_SEEDS = [
  {
    code: "new_event_intro",
    name: "New event introduction",
    channel: "email",
    category: "outreach",
    accessScope: "office",
    state: "active",
    subjectTemplate: "The Adventure Zone for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

I'm reaching out from The Adventure Zone about {{eventName}}. We're a traveling event company that brings a staffed inflatable-carnival experience to fairs, festivals, and community events.

I'd love to learn what you're planning and see whether one of our setups could be a good fit. If you're the right person to talk with, would you be open to a quick conversation? If not, I'd appreciate being pointed toward whoever handles entertainment or vendors.

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "past_customer_rebooking",
    name: "Past customer / rebooking",
    channel: "email",
    category: "rebooking",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Planning {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

We're starting to plan our upcoming season, and I'd love to talk about returning to {{eventName}}. Since we've worked together before, I don't want to make you start from scratch—I'd rather build from what worked well and anything you'd like changed this time.

Are you the right person to start planning with this year?

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "follow_up_next_season",
    name: "Follow up next season",
    channel: "email",
    category: "follow_up",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Following up about {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

You asked us to check back about {{eventName}}, so I'm following up while we're planning the season. We'd still love to see whether The Adventure Zone could fit what you're putting together this year.

If your dates or plans are available, send them my way and I can take a closer look.

Thanks,
{{senderName}}`,
  },
  {
    code: "pre_convention",
    name: "Pre-convention introduction",
    channel: "email",
    category: "convention",
    accessScope: "office",
    state: "active",
    subjectTemplate: "A quick introduction before {{conventionName}}",
    requiredPlaceholders: ["contactName", "conventionName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

We're getting ready for {{conventionName}}, and I wanted to introduce The Adventure Zone before the convention. We're a traveling event company with staffed attraction packages designed for fairs, festivals, and community events.

If you're planning entertainment for an upcoming event, I'd love to learn about your dates, crowd, and available space so we can point you toward the setup that makes the most sense.

I hope we get a chance to meet at the convention.

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "met_at_convention",
    name: "Met at convention",
    channel: "email",
    category: "convention",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Great meeting you about {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

It was great meeting you and hearing a little about {{eventName}}. Thanks for taking the time to talk with us.

Rather than bury you in a huge follow-up email, I'd be happy to send the current package information that best fits your event. If you send me your dates, approximate attendance, and available space, I can help narrow down the most useful options.

Thanks again,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "missed_at_convention",
    name: "Missed at convention",
    channel: "email",
    category: "convention",
    accessScope: "office",
    state: "active",
    subjectTemplate: "The Adventure Zone for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Sorry we missed you at the convention. I wanted to follow up because we'd still love to learn more about {{eventName}} and see whether The Adventure Zone could be a good fit.

We're a traveling event company that brings staffed inflatable-carnival packages rather than individual rental pieces. If you're the right person to talk with, I'd be happy to send the current options. If not, I'd appreciate being pointed toward whoever handles entertainment or vendors.

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "package_specific_intro",
    name: "Package-specific introduction",
    channel: "email",
    category: "package",
    accessScope: "office",
    state: "active",
    subjectTemplate: "{{packageName}} for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "packageName", "packagePrice", "packageDuration", "senderName"],
    bodyTemplate: `Hi {{contactName}},

I wanted to send a little more information about {{packageName}} for {{eventName}}. Our current starting price is {{packagePrice}} for a normal {{packageDuration}} booking, with the final setup tailored to the event and equipment availability.

We're different from a typical single-inflatable rental company: we operate as an event company, bringing the setup, teardown, staffing, and a complete attraction package.

If you'd like, I can help narrow down whether this package fits your crowd, space, and event goals.

Thanks,
{{senderName}}`,
  },
  {
    code: "mini_zone_option",
    name: "Mini Zone / smaller option",
    channel: "email",
    category: "package",
    accessScope: "office",
    state: "active",
    subjectTemplate: "A smaller Adventure Zone option for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "packagePrice", "packageDuration", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thanks for talking with us about {{eventName}}. If a full-size setup is more space or budget than you need, our Mini Zone may be worth considering. It keeps the Adventure Zone feel in a smaller five-attraction setup.

The current starting price is {{packagePrice}} for a normal {{packageDuration}} booking. Some events may also have other payment arrangements available, but those depend on the event and must be confirmed before we promise them.

Would you like me to send the current Mini Zone details?

Thanks,
{{senderName}}`,
  },
  {
    code: "budget_or_space_response",
    name: "Budget or space response",
    channel: "email",
    category: "objection",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Options for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thanks for letting me know. I completely understand that space and budget can shape what works for an event. We do have a smaller Mini Zone, and some events may qualify for a ticket-sales arrangement. I don't want to promise an option before we confirm the event details, but I'm happy to check what may be realistic for {{eventName}}.

If you'd like, send me the approximate available space and event dates and I'll take a look.

Thanks,
{{senderName}}`,
  },
  {
    code: "wrong_contact",
    name: "Wrong contact / contact verification",
    channel: "email",
    category: "contact",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Contact for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thank you for pointing me in the right direction. I've updated our contact information for {{eventName}}.

I appreciate the help, and I hope the event has a great season.

Thanks,
{{senderName}}`,
  },
  {
    code: "contract_ready",
    name: "Contract ready",
    channel: "email",
    category: "contract",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Contract for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

I'm excited that we're moving forward with {{eventName}}. I'm sending the Adventure Zone contract for you to review and sign. We use our signed contract—not a vendor application—as the document that secures the booking on our calendar.

Please let me know if anything in the contract needs clarification.

Thanks,
{{senderName}}`,
  },
  {
    code: "signed_contract_received",
    name: "Signed contract received",
    channel: "email",
    category: "contract",
    accessScope: "office",
    state: "active",
    subjectTemplate: "{{eventName}} is on our calendar",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thank you for sending the signed contract back. {{eventName}} is now on our calendar, and we're excited to be part of it.

Who should be our on-site point of contact when we arrive, and what is the best cell number for that person? We'll also review the event details again as the date gets closer.

Thanks,
{{senderName}}`,
  },
  {
    code: "deposit_received",
    name: "Deposit received",
    channel: "email",
    category: "payment",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Deposit received for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Just a quick note to let you know we received the deposit for {{eventName}}. Thank you!

Please reach out anytime if questions come up before the event. We're looking forward to seeing you.

Thanks,
{{senderName}}`,
  },
  {
    code: "coi_information_request",
    name: "COI information request",
    channel: "email",
    category: "insurance",
    accessScope: "office",
    state: "active",
    subjectTemplate: "COI information for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

I'd be happy to request the certificate of insurance for {{eventName}}. Please send the exact legal name and mailing address for each organization that must be listed as additionally insured, along with any specific wording your city, county, venue, or organization requires.

Once I have that information, we can send it to our insurance contact for processing.

Thanks,
{{senderName}}`,
  },
  {
    code: "thank_you_after_event",
    name: "Thank you after event",
    channel: "email",
    category: "relationship",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Thank you for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thank you for having The Adventure Zone at {{eventName}}. We appreciate the work that goes into putting an event together and were glad to be part of it.

If you have feedback—good or bad—I'd genuinely like to hear it. The good helps us recognize what worked, and the constructive feedback helps us improve.

Thanks again,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "holiday_message",
    name: "Holiday message",
    channel: "email",
    category: "relationship",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Holiday wishes from The Adventure Zone",
    requiredPlaceholders: ["contactName"],
    bodyTemplate: `Hi {{contactName}},

Warm holiday wishes from everyone at The Adventure Zone. Thank you for your support this year. We hope the season brings you time with the people you care about and a great start to the new year.

The Adventure Zone`,
  },
  {
    code: "ride_inspector_request",
    name: "Ride inspector request",
    channel: "internal_email",
    category: "operations",
    accessScope: "owner",
    state: "active",
    subjectTemplate: "Ride inspection availability — {{eventDates}}",
    requiredPlaceholders: ["eventDates", "eventCity", "eventState", "senderName"],
    bodyTemplate: `Hi,

We're looking for a ride inspector for {{eventDates}} in {{eventCity}}, {{eventState}}. Are you available, and what are your rates?

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "internal_coi_request",
    name: "Internal COI request",
    channel: "internal_email",
    category: "insurance",
    accessScope: "owner",
    state: "active",
    subjectTemplate: "COI request — {{eventName}}",
    requiredPlaceholders: ["eventName", "eventDates", "additionalInsuredWording", "additionalInsuredInfo", "senderName"],
    bodyTemplate: `Hi,

We're requesting a certificate of insurance for {{eventName}} for {{eventDates}}.

Additional insured wording:
{{additionalInsuredWording}}

Additional insured name and address information:
{{additionalInsuredInfo}}

Thanks,
{{senderName}}
The Adventure Zone`,
  },
] as const satisfies readonly CommunicationTemplateSeed[];

type Database = typeof database;

export async function ensureCommunicationTemplateSeed(database: Database): Promise<void> {
  await ensureBusinessSourceSeed(database);
  const sourceRows = await database
    .select({ id: businessSourceDocuments.id })
    .from(businessSourceDocuments)
    .where(eq(businessSourceDocuments.originalFilename, "ADVENTURE ZONE STICKY NOTES.docx.pdf"))
    .limit(1);
  const repository = new CommunicationTemplateRepository(database);
  await repository.seed(COMMUNICATION_TEMPLATE_SEEDS, sourceRows[0]?.id ?? null);
}
