import { BossAccountPanel } from "./OfficeCoordinatorAdminPage";

export default function BossAccessPage() {
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">Booking tools</p>
        <h1 className="mt-1 text-3xl font-bold">Boss Access</h1>
        <p className="mt-1 text-slate-600">Set the Boss username and password, update account names, and manage access.</p>
      </header>
      <BossAccountPanel />
    </div>
  );
}