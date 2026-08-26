import { eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { businessSourceDocuments } from "@/db/schema";
import type { CommunicationTemplateSeed } from "./communication-template-types";
import { CommunicationTemplateRepository } from "./communication-template-repository";
import { ensureBusinessSourceSeed } from "@/features/business-sources/business-source-seed";

export const COMMUNICATION_TEMPLATE_SEEDS = [
  {
    code: "new_event_intro",
    name: "Adventure Zone introduction",
    channel: "email",
    category: "outreach",
    accessScope: "office",
    state: "active",
    subjectTemplate: "The Adventure Zone for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "packageName", "packagePrice", "packageDuration", "senderName"],
    bodyTemplate: `Hi {{contactName}},

My name is {{senderName}}, and I work with Dave. We represent The Adventure Zone — America’s Best Inflatable Carnival! We’d love to come to your {{eventName}}!

Our Adventure Zone units feature a colorful mix of inflatable attractions, including obstacle courses, big slides, interactive competitions, carnival-style games, bouncy houses, and more.

For {{eventName}}, we can offer {{packageName}} at the current starting price of {{packagePrice}} for a normal {{packageDuration}} booking. In some instances, after we review the event, another arrangement may be available with no up-front guarantee and a percentage of ticket sales, but that has to be confirmed before we promise it.

We take care of the setup, teardown, and operation of our attractions. If you’d like to talk about whether we could be a good fit for {{eventName}}, I’d love to hear from you.

We look forward to hearing from you and hope you have a fantastic week!

{{senderName}}
The Adventure Zone`,
  },
  {
    code: "state_fair_email",
    name: "State fair outreach",
    channel: "email",
    category: "outreach",
    accessScope: "office",
    state: "active",
    subjectTemplate: "The Adventure Zone for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "packageName", "packagePrice", "packageDuration", "senderName"],
    bodyTemplate: `Hi {{contactName}},

My name is {{senderName}}, and I work with Dave. We represent The Adventure Zone — America’s Best Inflatable Carnival! We’d love to be considered for {{eventName}}.

For larger fairs, we can build a colorful attraction mix around {{packageName}}, including obstacle courses, slides, interactive attractions, carnival-style games, bouncy houses, and more. The current starting price is {{packagePrice}} for a normal {{packageDuration}} booking.

We handle set-up and tear-down, provide supervision and staffing for our operation, and can provide current certificate-of-insurance information as needed. Our goal is a fun-filled, family-friendly area that is easy for the event to work with.

If you’re open to it, I’d love to talk about your dates, available space, and what you’re looking for this year.

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "wrong_person_forward",
    name: "Wrong person / please forward",
    channel: "email",
    category: "contact",
    accessScope: "office",
    state: "active",
    subjectTemplate: "The Adventure Zone for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

I know I may not have the right person, but I couldn’t find an email for the person who handles entertainment or vendors for {{eventName}}. I was hoping you could help me out by forwarding this email to the right person, please. Thank you!

My name is {{senderName}}, and I work with Dave. We represent The Adventure Zone — America’s Best Inflatable Carnival! We’d love to come to your {{eventName}}.

If there’s a better person for me to contact directly, I’d really appreciate their name or email address.

Thanks again,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "past_customer_rebooking",
    name: "Previously attended / rebooking",
    channel: "email",
    category: "rebooking",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Planning {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

We’re starting to plan our upcoming season, and I wanted to check in about {{eventName}}. We’ve worked with your event before and would love to talk about coming back.

If your dates or plans are available, send them my way. We can build from what worked before and anything you’d like to change this time.

Are you the right person to start planning with this year?

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "follow_up_next_season",
    name: "Follow up with me later",
    channel: "email",
    category: "follow_up",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Following up about {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

You asked us to check back about {{eventName}}, so I’m following up while we’re planning the season. We’d still love to see whether The Adventure Zone could be a good fit for your event.

If you have your dates or updated plans now, send them my way and we can take another look.

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "are_you_having_event_this_year",
    name: "Are you having an event this year?",
    channel: "email",
    category: "follow_up",
    accessScope: "office",
    state: "active",
    subjectTemplate: "{{eventName}} this year",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

I’m checking in while we’re working on our schedule and wanted to see whether {{eventName}} is happening this year.

If it is, we’d love to talk with you about The Adventure Zone and see whether there may be a place for us at the event. If you already have dates or a current contact person, I’d appreciate anything you can send my way.

Thanks,
{{senderName}}
The Adventure Zone`,
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

My name is {{senderName}}, and I work with Dave. We represent The Adventure Zone — America’s Best Inflatable Carnival! We’re getting ready for {{conventionName}} and I wanted to introduce us before the convention.

If you’re planning entertainment for an upcoming fair or event, we’d love to learn about your dates, crowd, and available space. I hope we get a chance to meet at the convention.

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

We’d love to keep the conversation going. If you send me your current dates, approximate attendance, and available space, we can look at which Adventure Zone setup makes the most sense for your event.

Thanks again,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "missed_at_convention",
    name: "Didn't see you at convention",
    channel: "email",
    category: "convention",
    accessScope: "office",
    state: "active",
    subjectTemplate: "The Adventure Zone for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Sorry we didn’t get a chance to see you at the convention. I wanted to follow up because we’d still love to learn more about {{eventName}} and see whether The Adventure Zone could be a good fit.

If you’re the right person to talk with, I’d be happy to send the current options. If not, I’d appreciate being pointed toward whoever handles entertainment or vendors.

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

I wanted to send a little more information about {{packageName}} for {{eventName}}. The current starting price is {{packagePrice}} for a normal {{packageDuration}} booking, with the final setup tailored to the event and equipment availability.

We bring the setup, teardown, staffing, and a complete attraction package rather than dropping off individual rental pieces.

If you’d like, send me your available space, event dates, and what kind of crowd you’re planning for and we can talk through whether this package fits.

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

Thanks for getting back to us so quickly. Yes, we do have a scaled-down version. Our Mini Zone is a smaller five-attraction setup that still gives families a good mix of Adventure Zone fun.

The current starting price is {{packagePrice}} for a normal {{packageDuration}} booking. In some cases another payment arrangement may be possible, but we need to review the event before we promise that.

We would love to be a part of {{eventName}}. If you send me the space you have available, I can help you see whether the Mini Zone would fit.

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

Thanks for letting me know. I completely understand that space and budget can shape what works for an event.

We do have a smaller Adventure Zone option, and some events may have another payment arrangement available. I don’t want to promise something before we confirm the details, but I’m happy to see what may be realistic for {{eventName}}.

If you’d like, send me the approximate available space and event dates and I’ll take a look.

Thanks,
{{senderName}}`,
  },
  {
    code: "insurance_liability_response",
    name: "Insurance / liability concern response",
    channel: "email",
    category: "insurance",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Insurance information for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thanks for getting back to me so quickly. We understand why cities, venues, and event organizers take inflatable safety and liability seriously.

The Adventure Zone carries insurance for our operation, and we can provide current certificate-of-insurance information for review. When the event’s requirements allow it, the event holder can also be listed as additional insured. If your city, county, venue, or organization has specific insurance wording or limits, please send those requirements so we can review them before anyone promises we can meet them.

If it would help, we can also have the company owner speak with the appropriate person about how we operate and what documentation we can provide.

We hope {{eventName}} has a successful year, and we’d be glad to see if there’s a way to work together.

Thanks,
{{senderName}}
The Adventure Zone`,
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

I’d be happy to request the certificate of insurance for {{eventName}}. Please send the exact legal name and mailing address for each organization that needs to be listed as additional insured, along with any specific wording your city, county, venue, or organization requires.

Once I have that information, we can send it to the appropriate insurance contact for processing.

Thanks,
{{senderName}}`,
  },
  {
    code: "not_this_year_thank_you",
    name: "Thank you / not this year",
    channel: "email",
    category: "relationship",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Thank you — {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thanks for letting me know, and I appreciate you getting back to us. I understand that The Adventure Zone isn’t the right fit for {{eventName}} this year.

Please keep us in mind for the future if your plans, space, or entertainment needs change. I hope you have a fantastic and successful event this year!

Thanks again,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "wrong_contact",
    name: "Contact information updated",
    channel: "email",
    category: "contact",
    accessScope: "office",
    state: "active",
    subjectTemplate: "Contact for {{eventName}}",
    requiredPlaceholders: ["contactName", "eventName", "senderName"],
    bodyTemplate: `Hi {{contactName}},

Thank you for pointing me in the right direction. I’ve updated our contact information for {{eventName}}.

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

I’m excited that we’re moving forward with {{eventName}}. I’m sending the Adventure Zone contract for you to review and sign.

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

Thank you for sending the signed contract back. {{eventName}} is now on our calendar, and we’re excited to be part of it.

Who should be our on-site point of contact when we arrive, and what is the best cell number for that person? We’ll review the event details again as the date gets closer.

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

Please reach out anytime if questions come up before the event. We’re looking forward to seeing you.

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

If you have feedback — good or bad — I’d genuinely like to hear it. The good helps us recognize what worked, and the constructive feedback helps us improve.

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

We’re looking for a ride inspector for {{eventDates}} in {{eventCity}}, {{eventState}}. Are you available, and what are your rates?

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

We’re requesting a certificate of insurance for {{eventName}} for {{eventDates}}.

Additional insured wording:
{{additionalInsuredWording}}

Additional insured name and address information:
{{additionalInsuredInfo}}

Thanks,
{{senderName}}
The Adventure Zone`,
  },
  {
    code: "lead_introduction_2026_prepaid",
    name: "INTRO 2026 EMAIL PREPAID (approved v1)",
    channel: "email",
    category: "lead_introduction",
    accessScope: "office",
    state: "active",
    subjectTemplate: "{{eventName}} — {{eventDates}}",
    requiredPlaceholders: ["eventName", "eventDates"],
    bodyTemplate: `Approved safe lead-introduction source. The server-owned lead-email renderer supplies the verified recipient greeting, positive-normal-package sections only, and signature. My name is Desiree, and I work with Dave. We represent The Adventure Zone -- America's Best Inflatable Carnival! We’d love to come to your {{eventName}}!`,
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
