import { useEffect, useState } from "react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { ReceiptCapture } from "@/components/manager/receipt-capture";
import { ReceiptExpenseForm } from "@/components/manager/receipt-expense-form";

export default function ManagerReceiptsPage(){
  const {managerApi}=useManagerAuth();
  const [expenses,setExpenses]=useState<any[]>([]);
  const [mode,setMode]=useState<"receipt"|"manual"|null>(null);
  async function load(){
    try{const summary=await managerApi<any>("/manager/money/summary");setExpenses(summary.expenses??[]);}catch{setExpenses([]);}
  }
  useEffect(()=>{void load()},[managerApi]);
  return <div className="grid gap-4">
    <header><h1 className="text-2xl font-bold">Receipts</h1><p className="text-sm text-slate-600">Take a photo and let the app fill in the receipt details, or add an expense manually.</p></header>
    <div className="flex flex-wrap gap-2"><button className="button-primary" onClick={()=>setMode("receipt")}>+ Add receipt</button><button className="button-secondary" onClick={()=>setMode("manual")}>Add expense manually</button></div>
    {mode?<ReceiptExpenseForm key={mode} mode={mode} onDone={()=>{setMode(null);void load();}}/>:null}
    {expenses.length?expenses.map(e=><section key={e.id} className="grid gap-2 rounded-xl border bg-white p-4"><p className="font-semibold">{e.merchant||e.category} — ${(e.amountCents/100).toFixed(2)}</p><ReceiptCapture expenseId={e.id}/></section>):<section className="rounded-xl border border-dashed bg-white p-5 text-center"><p className="font-semibold">No expenses yet.</p><p className="mt-1 text-sm text-slate-600">Use Add receipt to scan your first one.</p></section>}
  </div>
}
