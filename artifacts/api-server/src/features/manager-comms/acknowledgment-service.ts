import type { AcknowledgmentRepository } from "./acknowledgment-repository";

export class AcknowledgmentService {
  constructor(private readonly repository:AcknowledgmentRepository){}

  async recordAdminOperationalChange(input:{
    actionId:string; legIds:string[]; actor:string; sourceType:string; sourceId:string|null; title:string;
    items:Array<{label:string;beforeValue:string|null;afterValue:string|null}>;
  }){
    const uniqueLegIds=[...new Set(input.legIds)];
    const result=[];
    for(const legId of uniqueLegIds){
      const row=await this.repository.createOrGet({actionId:input.actionId,legId,actor:input.actor,sourceType:input.sourceType,sourceId:input.sourceId,title:input.title,items:input.items});
      if(row) result.push(row);
    }
    return result;
  }

  async acknowledge(id:string,legId:string,comment:string|null){
    const row=await this.repository.acknowledge(id,legId,comment);
    if(!row) throw Object.assign(new Error("Acknowledgment not found or already handled"),{code:"NOT_FOUND"});
    return row;
  }

  async resolve(id:string,response:string|null,actor:string){
    const row=await this.repository.resolve(id,response,actor);
    if(!row) throw Object.assign(new Error("Acknowledgment not found or already resolved"),{code:"NOT_FOUND"});
    return row;
  }
}
