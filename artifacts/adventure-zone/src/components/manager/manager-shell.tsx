import { useEffect } from "react";
import { Link } from "wouter";
import { Home, MapPinned, LogOut, WalletCards, UsersRound } from "lucide-react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue } from "@/lib/manager-sync-queue";

export function ManagerShell({ children }: { children: React.ReactNode }) {
  const { manager, signOut, managerApi } = useManagerAuth();

  useEffect(() => {
    const flush = () => void flushManagerMutationQueue(managerApi).catch(() => undefined);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [managerApi]);

  return <div className="min-h-dvh bg-slate-50 pb-20">
    <header className="sticky top-0 z-10 border-b bg-white px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <div><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Leg Manager Portal</p><p className="font-semibold">{manager?.legName}</p></div>
        <button className="rounded-lg p-2" aria-label="Sign out" onClick={signOut}><LogOut className="h-5 w-5" /></button>
      </div>
    </header>
    <main className="mx-auto max-w-3xl p-4">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-white"><div className="mx-auto grid max-w-3xl grid-cols-4">
      <Link href="/manager" className="flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><Home className="h-5 w-5" />Home</Link>
      <Link href="/manager/route" className="flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><MapPinned className="h-5 w-5" />Events / Route</Link>
      <Link href="/manager/money" className="flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><WalletCards className="h-5 w-5" />Money</Link>
      <Link href="/manager/crew" className="flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><UsersRound className="h-5 w-5" />Crew</Link>
    </div></nav>
  </div>;
}
