// Source: Gmail draft 1a083d3ca1ce74c4, "OPEN ME!! Convention Planning Decisions — Please Complete".
export type PlanningField = { key: string; label: string; kind?: "date" | "long"; choices?: readonly string[] };
export type PlanningSection = { title: string; date?: string; paragraphs: string[]; fields: PlanningField[] };
const stay = (prefix: string, attendees = "Attendee(s):"): PlanningField[] => [
  {key:`${prefix}Attendees`,label:attendees},
  {key:`${prefix}Rooms`,label:"Number of hotel rooms:"},
  {key:`${prefix}CheckIn`,label:"Check-in date:",kind:"date"},
  {key:`${prefix}CheckOut`,label:"Check-out date:",kind:"date"},
];
export const planningSections: PlanningSection[] = [
  {title:"1. ROCKY MOUNTAIN ASSOCIATION OF FAIRS (RMAF)",date:"November 11–13, 2026 — Layton, Utah",
    paragraphs:["Registration is $300 per person if completed by October 16. The 2026 service-membership dues of $110 have already been paid. The hotel is $164 per night plus tax, and the room/display reservation must be made through RMAF."],
    fields:[...stay("rmaf","Attendees:"),{key:"rmafAdvertising",label:"Advertising choice:",choices:["$250 — Full-page ad, popup and promotional table","$325 — Full-page ad, popup, promotional table and email blast","$600 — Silver sponsorship with half-page ad, name on the banner, logo on the meal slides and recognition in the convention newsletter","No advertising","Other"]},{key:"rmafAdvertisingOther",label:"Other:"}]},
  {title:"2. WYOMING ASSOCIATION OF FAIRS",date:"October 6–7, 2026 — Pinedale/Big Piney, Wyoming",
    paragraphs:["You mentioned attending only the showcase day, like last year. The current information only lists October 6–7, and I cannot find a separate Saturday district showcase. I can email them to confirm whether there is a separate showcase day this year and get the correct date and details.","The first registration is free if our 2026 membership dues are current. I still need to confirm the membership status."],
    fields:[{key:"wyomingAttendees",label:"Attendee(s):"},{key:"wyomingAttendance",label:"Attendance",choices:["Attend only the confirmed showcase day","Attend the full convention","Do not attend"]}]},
  {title:"3. HEARTLAND ASSOCIATION",date:"November 19–21, 2026 — Minot, North Dakota",
    paragraphs:["The hotel-block deadline is October 15, and the early-registration deadline is November 5. I still need to confirm the registration, booth and sponsorship prices."],
    fields:[{key:"heartlandAttendance",label:"Attendance",choices:["Attend","Do not attend"]},...stay("heartland")]},
  {title:"4. WESTERN FAIRS ASSOCIATION/CALIFORNIA",date:"January 31–February 3, 2027 — Las Vegas, Nevada",
    paragraphs:["Membership should be $350 under Acts & Attractions if we qualify for that category, or $625 under Carnival. Do you wnat me to email them? Amy said you guys called them? A member 10×10 trade-show booth is $1,150 and includes two convention badges. South Point’s convention room rate is $89 on weeknights and $185 on Friday/Saturday, plus tax. Registration is not open yet."],
    fields:[{key:"westernAttendance",label:"Attendance",choices:["Attend","Do not attend"]},{key:"westernBooth",label:"Trade-show booth",choices:["Reserve a trade-show booth","Attend without a booth"]},...stay("western"),{key:"westernEmail",label:"Do you wnat me to email them?",choices:["Yes","No"]},{key:"westernCall",label:"Amy said you guys called them?"}]},
  {title:"5. COLORADO ASSOCIATION OF FAIRS AND SHOWS",
    paragraphs:["Their next convention registration has not been posted. I will email them to ask when it will be available and continue checking the website. No decision or payment is needed yet."],fields:[]},
  {title:"Budget and additional notes",paragraphs:[],fields:[{key:"budget",label:"Overall convention budget limit, if you want me to stay under one for future reference:",},{key:"additionalNotes",label:"Anything else you want me to know:",kind:"long"}]},
];
