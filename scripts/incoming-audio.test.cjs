const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'artifacts/adventure-zone/src/features/calls/incoming-audio.ts'),'utf8').replace(/^import type[\s\S]*?;\n/gm,'').replace(/^export /gm,'');
const {prepareIncomingAudio,readIncomingAudioPreferences,saveIncomingAudioPreferences}=new Function(stripTypeScriptTypes(src,{mode:'strip'})+';return {prepareIncomingAudio,readIncomingAudioPreferences,saveIncomingAudioPreferences};')();
const mic=id=>({deviceId:id,label:id,kind:'audioinput'}),speaker=id=>({deviceId:id,label:id,kind:'audiooutput'});
function device(inputs=[mic('default'),mic('voicemod')],outputs=[speaker('default'),speaker('headset')]){
 const calls=[];return {calls,listAudioDevices:async()=>({inputs,outputs}),selectInput:async id=>calls.push(['input',id]),selectOutput:async id=>{calls.push(['output',id]);return true;}};
}
test('incoming setup applies saved Voicemod microphone and real headset before listening',async()=>{
 const d=device();const audio=await prepareIncomingAudio(d,{inputId:'voicemod',outputId:'headset'});
 assert.deepEqual(d.calls,[['input','voicemod'],['output','headset']]);assert.equal(audio.inputId,'voicemod');assert.equal(audio.outputId,'headset');
});
test('removed saved devices fall back visibly to available defaults',async()=>{
 const d=device();const audio=await prepareIncomingAudio(d,{inputId:'gone',outputId:'gone'});
 assert.deepEqual(d.calls,[['input','default'],['output','default']]);assert.match(audio.warning,/no longer available/);
});
test('microphone failure prevents readiness',async()=>{
 const d=device();d.selectInput=async()=>{throw Error('Permission denied');};
 await assert.rejects(prepareIncomingAudio(d,{}),/Permission denied/);assert.deepEqual(d.calls,[]);
});
test('unsupported speaker choice reports browser system output without a false selected headset',async()=>{
 const d=device();d.selectOutput=async()=>false;const audio=await prepareIncomingAudio(d,{outputId:'headset'});
 assert.equal(audio.outputSupported,false);assert.equal(audio.outputId,'');assert.match(audio.warning,/system speaker/);
});
test('preferences are local and tolerate unavailable or corrupt storage',()=>{
 const store=new Map();const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
 saveIncomingAudioPreferences({inputId:'voicemod',outputId:'headset'},storage);
 assert.deepEqual(readIncomingAudioPreferences(storage),{inputId:'voicemod',outputId:'headset'});
 storage.getItem=()=>'{bad';assert.deepEqual(readIncomingAudioPreferences(storage),{});
 const blocked={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}};
 assert.deepEqual(readIncomingAudioPreferences(blocked),{});assert.doesNotThrow(()=>saveIncomingAudioPreferences({},blocked));
});
