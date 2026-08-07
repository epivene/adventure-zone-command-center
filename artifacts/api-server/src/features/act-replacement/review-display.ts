const universalDisplayFields = ["name", "displayname", "title", "subject"];

const displayFieldsByStream: Readonly<Record<string, readonly string[]>> = {
  company: [
    ...universalDisplayFields,
    "company",
    "companyname",
    "phone",
    "website",
    "address",
    "address1",
    "address2",
    "city",
    "state",
    "region",
    "postalcode",
    "zipcode",
    "country",
  ],
  contact: [
    ...universalDisplayFields,
    "firstname",
    "lastname",
    "fullname",
    "company",
    "companyname",
    "jobtitle",
    "email",
    "phone",
    "city",
    "state",
    "region",
  ],
  opportunity: [
    ...universalDisplayFields,
    "opportunityname",
    "stage",
    "status",
    "estimatedclosedate",
    "city",
    "state",
    "region",
  ],
  group: [...universalDisplayFields, "description"],
  activity: [
    ...universalDisplayFields,
    "type",
    "starttime",
    "endtime",
    "occurredat",
    "regarding",
  ],
  note: [...universalDisplayFields, "type", "occurredat", "regarding"],
  history: [...universalDisplayFields, "type", "occurredat", "regarding"],
};

const universalDisplayFieldSet = new Set(universalDisplayFields);
const displayFieldSetsByStream = new Map(
  Object.entries(displayFieldsByStream).map(([streamType, fields]) => [
    streamType,
    new Set(fields),
  ]),
);

/**
 * Public review display values are allowlisted by Act stream. Unknown and
 * relationship streams receive only the universal name/title fields.
 */
export function projectActReviewDisplay(
  streamType: string | undefined,
  raw: unknown,
): Record<string, string | number | boolean | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const allowed =
    displayFieldSetsByStream.get(streamType?.toLowerCase() ?? "") ??
    universalDisplayFieldSet;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key.toLowerCase())) continue;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] = value;
    }
  }
  return output;
}
