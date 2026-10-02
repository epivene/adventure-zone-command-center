import { readFileSync } from "node:fs";
const root=process.env.RUNNER_TEMP;
function diagnostics(name){
 const content=readFileSync(root+"/"+name+"-types.txt","utf8").replace(/\x1b\[[0-9;]*m/g,"");
 const normalize=s=>s.replaceAll(process.cwd()+"/baseline","<repo>").replaceAll(process.cwd(),"<repo>").replace(/\(\d+,\d+\)/g,"(line,column)");
 const blocks=[];let current=null;
 for(const line of content.split("\n")){
  if(/^.+\(\d+,\d+\): error TS\d+:/.test(line)||/^error TS\d+:/.test(line)){if(current)blocks.push(normalize(current));current=line;}
  else if(current&&/^\s+\S/.test(line))current+="\n"+line;
  else if(current){blocks.push(normalize(current));current=null;}
 }
 if(current)blocks.push(normalize(current));
 const exit=readFileSync(root+"/"+name+"-types.exit","utf8").trim();
 if(exit!=="0"&&!blocks.length)throw new Error(name+" typecheck failed without captured TypeScript diagnostics:\n"+content);
 return blocks;
}
let failed=false;
for(const pkg of ["api","ui"]){
 const base=diagnostics("base-"+pkg),head=diagnostics("head-"+pkg),remaining=[...base],newErrors=[];
 for(const error of head){const i=remaining.indexOf(error);if(i<0)newErrors.push(error);else remaining.splice(i,1);}
 console.log(pkg+": baseline "+base.length+" diagnostics; branch "+head.length+"; new "+newErrors.length);
 if(newErrors.length){failed=true;console.error(newErrors.join("\n\n"));}
}
if(failed)process.exit(1);
