const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
function client(apiFetch){const source=fs.readFileSync(path.join(root,'artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts'),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/^export /gm,'');return new Function('apiFetch',stripTypeScriptTypes(source,{mode:'strip'})+';return {deleteGoogleProfileLabels,getGoogleProfileLabelCleanupPreview};')(apiFetch);}
test('101 selected labels are rejected before making a destructive request',async()=>{
 let calls=0;const api=client(async()=>{calls++;return new Response(JSON.stringify({error:'GOOGLE_WORKSPACE_PROFILE_LABEL_CLEANUP_INPUT_INVALID'}),{status:400});});
 await assert.rejects(api.deleteGoogleProfileLabels(Array.from({length:101},(_,i)=>'Label_'+i)),/100/);assert.equal(calls,0);
});
test('100 labels keep explicit confirmation and a single bounded request',async()=>{
 const ids=Array.from({length:100},(_,i)=>'Label_'+i);let calls=0;
 const api=client(async(url,options)=>{calls++;assert.equal(url,'/google-workspace/profile-labels/cleanup');assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{labelIds:ids,confirm:true});return new Response(JSON.stringify({deleted:[],skippedLabelIds:ids,failed:[]}));});
 const result=await api.deleteGoogleProfileLabels(ids);assert.equal(calls,1);assert.deepEqual(result.skippedLabelIds,ids);
});
test('empty selections never make a delete request',async()=>{
 let calls=0;const api=client(async()=>{calls++;throw Error('Unexpected request');});await assert.rejects(api.deleteGoogleProfileLabels([]),/Select/);assert.equal(calls,0);
});
test('opening cleanup is a preview request with no confirmation or deletion body',async()=>{
 const api=client(async(url,options={})=>{assert.equal(url,'/google-workspace/profile-labels/cleanup');assert.equal(options.method||'GET','GET');assert.equal(options.body,undefined);return new Response(JSON.stringify({labels:[]}));});assert.deepEqual(await api.getGoogleProfileLabelCleanupPreview(),{labels:[]});
});