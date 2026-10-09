import type { EndpointEvidence } from "./date-evidence";

type SelectedEndpoint = Pick<EndpointEvidence,"field"|"value"|"semantics">;

// This is a format matcher for an already linked/reviewed saved source,
// not independent verification, a time parser or permission to change dates.
export function savedSourceProvesDate(content: string, endpoint: SelectedEndpoint): boolean {
  const value=endpoint.value;
  if(!value)return false;
  // Preserve exact ISO evidence, but reject accidental prefixes (e.g. July 140).
  const escaped=value.replace(/[.*+?^{}()|[\]\\$]/g,"\\$&");
  if(new RegExp("(?<![\\dA-Za-z])"+escaped+"(?![\\dA-Za-z])").test(content))return true;
  if(endpoint.semantics!=="inclusive_date"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;

  // Normalize explicit US numeric dates and day-first named dates only.
  // A missing year remains missing; the requested endpoint supplies no context.
  const monthLabels=["January","February","March","April","May","June","July","August","September","October","November","December"];
  const normalized=content
    .replace(/\b(\d{1,2})\/(\d{1,2})\/((?:19|20|21)\d{2})\b/g,(text,month,day,year)=>{
      const label=monthLabels[Number(month)-1];
      return label?label+" "+day+", "+year:text;
    })
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s*([-–—]|to|through)\s*(\d{1,2})(?:st|nd|rd|th)?)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+((?:19|20|21)\d{2})\b/gi,
      (_text,start,separator,end,month,year)=>month+" "+start+(end?separator+end:"")+", "+year);
  const lines=normalized.replace(/\r\n?/g,"\n").split("\n");
  const first=lines.find(line=>line.trim())?.trim()??"";
  // An explicit agreement/season heading can scope later undated clauses.
  // Never borrow the requested date's year, booking year or note creation year.
  const heading=/^(?:#{1,6}\s*)?(?:(?:agreement|event|season|year)\s*[:–-]?\s*)?((?:19|20|21)\d{2})(?!-\d{2}-\d{2})(?=\b|$)/i.exec(first);
  const headingYear=heading?Number(heading[1]):null;
  const monthNames="Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  const ordinal="(?:st|nd|rd|th)?";
  const year="((?:19|20|21)\\d{2})";
  const dates=new RegExp("\\b("+monthNames+")\\.?\\s+(\\d{1,2})"+ordinal+"\\b(?:,?\\s+"+year+")?"+
    "(?:\\s*(?:[-–—]|\\bto\\b|\\bthrough\\b)\\s*(?:("+monthNames+")\\.?\\s+)?(\\d{1,2})"+ordinal+"\\b(?:,?\\s+"+year+")?)?","gi");
  const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const operational=/\b(?:access|setup|set[- ]?up|tear[- ]?down|teardown|arrival|departure|reservation|load[- ]?(?:in|out)|operational)\b/i;
  const milestones=/\b(?:deposit|payment|invoice|check|paperwork|deadline|reminder|follow[- ]?up|emailed|called|COI|insurance)\b/i;
  const publicDates=/\b(?:public|(?:event|show|rodeo|fair)(?: dates?)?)\b/i;

  for(const line of lines){
    for(const clause of line.split(/(?<=[.!?])\s+(?=[A-Z])|[;•|]/)){
      const years=[...new Set(clause.match(/\b(?:19|20|21)\d{2}\b/g)??[])];
      if(years.length>1)continue;
      const explicitYear=years.length===1?Number(years[0]):headingYear;
      if(explicitYear===null)continue;
      const isOperational=operational.test(clause);
      // Human access/reservation clauses cannot verify public dates, and
      // generic event dates cannot establish equipment/crew reservations.
      if(isOperational&&publicDates.test(clause))continue;
      if(milestones.test(clause)&&!publicDates.test(clause)&&!isOperational)continue;
      if(endpoint.field.startsWith("reservation_")!==isOperational)continue;
      dates.lastIndex=0;
      for(const match of clause.matchAll(dates)){
        const startMonth=months.indexOf(match[1]!.slice(0,3).toLowerCase())+1;
        const endMonth=match[4]?months.indexOf(match[4].slice(0,3).toLowerCase())+1:startMonth;
        const startDay=Number(match[2]),endDay=Number(match[5]??match[2]);
        const startYear=Number(match[3]??explicitYear),endYear=Number(match[6]??explicitYear);
        const start=new Date(Date.UTC(startYear,startMonth-1,startDay));
        const end=new Date(Date.UTC(endYear,endMonth-1,endDay));
        // UTC is used only for validating calendar components; existing
        // dateEndpointInstant supplies the app's America/Denver semantics.
        if(start.getUTCFullYear()!==startYear||start.getUTCMonth()+1!==startMonth||start.getUTCDate()!==startDay||
          end.getUTCFullYear()!==endYear||end.getUTCMonth()+1!==endMonth||end.getUTCDate()!==endDay||end<start)continue;
        const selected=endpoint.field.endsWith("_start")?start:end;
        if(selected.toISOString().slice(0,10)===value)return true;
      }
    }
  }
  return false;
}
