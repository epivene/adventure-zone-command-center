import type { TripSegmentRecord,TripStopRecord } from "@/features/trips/trip-repository";
export type ManagerTrip={id:string;travelLegId:string;name:string;startDate:Date;endDate:Date;startLabel:string;endLabel:string};
export interface LegManagerDashboardRepository{listTrips(o:{travelLegId:string}):Promise<ManagerTrip[]>;listStops(id:string):Promise<TripStopRecord[]>;listSegments(id:string):Promise<TripSegmentRecord[]>;}
export async function loadLegManagerDashboard(repo:LegManagerDashboardRepository,legId:string,now=new Date()){
  const all=(await repo.listTrips({travelLegId:legId})).filter(t=>t.travelLegId===legId).sort((a,b)=>a.startDate.getTime()-b.startDate.getTime());
  const trips=all.filter(t=>t.endDate.getTime()>=now.getTime()-86400000);
  const details=await Promise.all(trips.map(async t=>({trip:t,stops:await repo.listStops(t.id),segments:await repo.listSegments(t.id)})));
  const events=details.flatMap(d=>d.stops.map(s=>({...s,tripName:d.trip.name}))).sort((a,b)=>(a.startsAt?.getTime()??0)-(b.startsAt?.getTime()??0));
  const current=details.find(d=>d.trip.startDate<=now&&d.trip.endDate>=now)??details[0]??null;
  const nextEvent=events.find(e=>(e.endsAt??e.startsAt??new Date(0))>=now)??null;
  return {legId,trips,route:current,events,nextEvent};
}
