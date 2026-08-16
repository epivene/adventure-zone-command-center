import { useEffect,useState } from 'react';
import { ManagerScopedMap } from '@/components/manager/manager-scoped-map';
import { MileageForm } from '@/components/manager/mileage-form';
import { MaintenanceForm } from '@/components/manager/maintenance-form';
import { useManagerScopedMap } from '@/features/manager/use-manager-scoped-map';
import { useManagerAuth } from '@/lib/manager-auth-context';

export default function ManagerOperationsPage(){
  const{managerApi}=useManagerAuth();const[dashboard,setDashboard]=useState<any>(null);const[rollup,setRollup]=useState<any>(null);const map=useManagerScopedMap();
  useEffect(()=>{managerApi<any>('/manager/dashboard').then(async d=>{setDashboard(d);const tripId=d.route?.trip?.id??d.trips?.[0]?.id;if(tripId)setRollup(await managerApi(`/manager/operations/segments?tripId=${tripId}`))})},[managerApi]);
  const tripId=dashboard?.route?.trip?.id??dashboard?.trips?.[0]?.id??null;
  return <div className="grid gap-4">
    <h1 className="text-2xl font-bold">Trip operations</h1>
    {map.error?<p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{map.error}</p>:null}
    {map.data?<ManagerScopedMap data={map.data} variant="operations"/>:map.loading?<p className="text-sm text-slate-500">Loading map…</p>:null}
    {rollup?<section className="rounded-xl border bg-white p-4"><p>Route miles: {rollup.trip.routeMiles}</p><p>Recorded miles: {rollup.trip.recordedMiles}</p><p>Segment expenses: ${(rollup.trip.expenseTotalCents/100).toFixed(2)}</p></section>:null}
    {!tripId?<p className="rounded-xl border bg-orange-50 p-3 text-sm">No current trip. Entries below will still be saved to this leg.</p>:null}
    <MileageForm tripId={tripId}/><MaintenanceForm tripId={tripId}/>
  </div>
}
