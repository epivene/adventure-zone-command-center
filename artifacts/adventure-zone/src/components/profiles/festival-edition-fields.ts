export type EditionField = { key: string; label: string; type?: "date" | "url" | "text" | "long" };
export const editionGroups: { title: string; fields: EditionField[] }[] = [
  { title: "Schedule, location & attendance", fields: [
    { key: "startsOn", label: "Start date", type: "date" }, { key: "endsOn", label: "End date", type: "date" },
    { key: "hours", label: "Event hours" }, { key: "venue", label: "Venue and event address" },
    { key: "setting", label: "Indoor / outdoor setting" }, { key: "category", label: "Event category" },
    { key: "attendance", label: "Attendance estimate" }, { key: "editionHistory", label: "Edition number and event history" },
  ] },
  { title: "Artist exhibitors & applications", fields: [
    { key: "exhibitors", label: "Exhibitor count" }, { key: "juried", label: "Juried status and terms" },
    { key: "boothFee", label: "Booth size and fees" }, { key: "applicationDeadline", label: "Application deadline", type: "date" },
    { key: "applicationTerms", label: "Application and payment terms", type: "long" }, { key: "applicationUrl", label: "Application link", type: "url" },
    { key: "prizes", label: "Prizes and awards" }, { key: "acceptedCategories", label: "Accepted categories" },
    { key: "handmadePercent", label: "Required handmade percentage" }, { key: "insurance", label: "Insurance requirements" },
    { key: "restrictions", label: "Restrictions and allowed items", type: "long" },
  ] },
  { title: "Food vendors & trucks", fields: [
    { key: "foodVendors", label: "Food vendor and truck counts" }, { key: "foodFees", label: "Food booth and truck fees" },
    { key: "foodDeadline", label: "Food application deadline", type: "date" }, { key: "foodApplicationUrl", label: "Food application link", type: "url" },
    { key: "foodInsurance", label: "Food vendor insurance and permits" }, { key: "foodRequirements", label: "Food vendor requirements", type: "long" },
  ] },
  { title: "Performances, activities & admission", fields: [
    { key: "stages", label: "Stages and entertainment" }, { key: "performerPay", label: "Performer pay and terms" },
    { key: "performanceDeadline", label: "Performer application deadline", type: "date" }, { key: "performanceApplicationUrl", label: "Performer application link", type: "url" },
    { key: "activities", label: "Activities", type: "long" }, { key: "admission", label: "Admission and ticket prices" },
  ] },
  { title: "Event description, images & visitor FAQs", fields: [
    { key: "description", label: "Edition description", type: "long" }, { key: "photoGalleryUrl", label: "Photo gallery link", type: "url" },
    { key: "promoter", label: "Promoter listed for this event" }, { key: "mainEmail", label: "Event listing email" },
    { key: "sourceUrl", label: "FestivalNet source link", type: "url" }, { key: "sourceFilename", label: "Imported source file" },
    { key: "weather", label: "Weather / rain policy" }, { key: "pets", label: "Pet policy" },
    { key: "accessibility", label: "Accessibility", type: "long" }, { key: "ages", label: "Age restrictions" },
    { key: "childPrices", label: "Child admission prices" },
  ] },
  { title: "Setup, lodging & logistics", fields: [
    { key: "setup", label: "Setup / teardown schedule" }, { key: "logistics", label: "Parking, load-in and other logistics", type: "long" },
    { key: "lodging", label: "Lodging and camping" }, { key: "calendarUrl", label: "Event calendar link", type: "url" },
  ] },
];
