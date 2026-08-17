import { queueManagerMutation } from "@/lib/manager-sync-queue";
import {
  getManagerAssistantContext,
  saveManagerAssistantContext,
} from "./manager-assistant-offline-cache";
import type {
  ManagerAdminQuestion,
  ManagerAssistantAnswer,
  ManagerAssistantContextBundle,
  ManagerAssistantContextRef,
} from "./manager-assistant-types";

type ManagerApi = <T>(path: string, options?: RequestInit) => Promise<T>;

function normalize(value:string){return value.toLowerCase().replace(/[?!.,'’]/g," ").replace(/\s+/g," ").trim();}
function offlineAnswer(question:string,context:ManagerAssistantContextBundle):ManagerAssistantAnswer{
  const q=normalize(question);
  if(/forklift|loader|setup|tear ?down|power|electric|water|stake|ballast/.test(q)){
    const terms=q.split(" ").filter(term=>term.length>4);
    const matches=context.operationalInstructions.filter(item=>terms.some(term=>normalize(item.summary).includes(term)));
    if(matches.length)return{text:matches.slice(0,3).map(item=>item.summary).join(" "),mode:"offline_cached",confidence:"medium",sources:[],needsAdmin:false,escalationReason:null};
  }
  if(/meetup|handoff|swap|paintball/.test(q)&&context.handoffs.length)return{text:context.handoffs.slice(0,3).map(item=>item.summary).join(" "),mode:"offline_cached",confidence:"medium",sources:[],needsAdmin:false,escalationReason:null};
  if(/what.*next|next event|where.*next|schedule/.test(q)&&context.assignedEvents[0]){const event=context.assignedEvents[0];return{text:`${event.name}${event.city||event.region?` in ${[event.city,event.region].filter(Boolean).join(", ")}`:""}${event.startsAt?` starts ${event.startsAt}`:""}.`,mode:"offline_cached",confidence:"medium",sources:[],needsAdmin:false,escalationReason:null};}
  if(/package|equipment|what.*bringing|what.*taking/.test(q)){const event=(context.activeEvent as any)??context.assignedEvents[0];if(event){const parts=[event.packageNames?.length?`Packages: ${event.packageNames.join(", ")}.`:null,event.resourceNames?.length?`Equipment: ${event.resourceNames.join(", ")}.`:null].filter(Boolean);if(parts.length)return{text:parts.join(" "),mode:"offline_cached",confidence:"medium",sources:[],needsAdmin:false,escalationReason:null};}}
  return{text:"I'm offline and the saved manager data doesn't answer that confidently. You can queue this for an admin and it will send when the connection returns.",mode:"offline_cached",confidence:"low",sources:[],needsAdmin:true,escalationReason:"Offline saved operational data is insufficient for this question."};
}

export async function loadManagerAssistantContext(managerApi: ManagerApi, legId:string, context: ManagerAssistantContextRef) {
  const params = new URLSearchParams({ kind: context.kind, id: context.recordId });
  try{
    const result=await managerApi<{ context: ManagerAssistantContextBundle }>(`/manager/assistant/context?${params}`);
    await saveManagerAssistantContext({legId,contextRef:context,context:result.context}).catch(()=>undefined);
    return {...result,offline:false};
  }catch(error){
    const status=typeof error==="object"&&error&&"status" in error?Number((error as {status?:number}).status):undefined;
    if(status&&status<500)throw error;
    const cached=await getManagerAssistantContext(legId,context).catch(()=>null);
    if(!cached)throw error;
    return{context:cached.context,offline:true};
  }
}

export async function askManagerAssistant(managerApi: ManagerApi, legId:string, context: ManagerAssistantContextRef, question: string) {
  try{
    const result=await managerApi<{ context: ManagerAssistantContextBundle; answer: ManagerAssistantAnswer }>("/manager/assistant/ask", {
      method: "POST",
      body: JSON.stringify({ contextKind: context.kind, contextRecordId: context.recordId, question }),
    });
    await saveManagerAssistantContext({legId,contextRef:context,context:result.context}).catch(()=>undefined);
    return{...result,offline:false};
  }catch(error){
    const status=typeof error==="object"&&error&&"status" in error?Number((error as {status?:number}).status):undefined;
    if(status&&status<500)throw error;
    const cached=await getManagerAssistantContext(legId,context).catch(()=>null);
    if(!cached)throw error;
    return{context:cached.context,answer:offlineAnswer(question,cached.context),offline:true};
  }
}

export async function listManagerAdminQuestions(managerApi: ManagerApi) {
  return managerApi<{ questions: ManagerAdminQuestion[] }>("/manager/assistant/admin-questions");
}

export async function askAdminFromManager(input: {
  managerApi: ManagerApi;
  legId: string;
  context: ManagerAssistantContextRef;
  question: string;
  urgency: "normal" | "urgent";
  escalationReason: string;
}) {
  const clientMutationId = crypto.randomUUID();
  const body = {
    contextKind: input.context.kind,
    contextRecordId: input.context.recordId,
    question: input.question,
    urgency: input.urgency,
    escalationReason: input.escalationReason,
    clientMutationId,
  };
  try {
    const result = await input.managerApi<{ question: ManagerAdminQuestion & { idempotent?: boolean } }>(
      "/manager/assistant/admin-questions",
      { method: "POST", body: JSON.stringify(body) },
    );
    return { state: "sent" as const, question: result.question };
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : undefined;
    if (status && status < 500) throw error;
    await queueManagerMutation({
      id: clientMutationId,
      legId: input.legId,
      method: "POST",
      path: "/manager/assistant/admin-questions",
      body,
      createdAt: new Date().toISOString(),
    });
    return { state: "saved_offline" as const, question: null };
  }
}
