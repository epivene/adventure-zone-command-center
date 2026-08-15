import type { NextFunction,Request,Response } from "express";
import { verifyLegManagerToken } from "./leg-manager-auth";
export type LegManagerRequestContext={legId:string;managerName:string|null};
export interface LegManagerSessionRepository { getActiveAccess(legId:string):Promise<{legId:string;managerName:string|null;sessionVersion:number}|null>; }
declare global { namespace Express { interface Request { legManager?:LegManagerRequestContext; } } }
export async function resolveLegManagerSession(token:string,repo:LegManagerSessionRepository):Promise<LegManagerRequestContext|null>{
  const c=verifyLegManagerToken(token); if(!c)return null;
  const a=await repo.getActiveAccess(c.legId); if(!a||a.legId!==c.legId||a.sessionVersion!==c.sessionVersion)return null;
  return {legId:a.legId,managerName:a.managerName};
}
export function createRequireLegManagerMiddleware(repo:LegManagerSessionRepository){return async(req:Request,res:Response,next:NextFunction):Promise<void>=>{
  const h=req.headers.authorization; if(!h?.startsWith("Bearer ")){res.status(401).json({error:"Manager authentication required"});return;}
  const c=await resolveLegManagerSession(h.slice(7),repo); if(!c){res.status(401).json({error:"Manager session is invalid or expired"});return;}
  req.legManager=c; next();
};}
