const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),ts=require(process.env.AZ_TYPESCRIPT_PATH),React=require(process.env.AZ_REACT_PATH),jsx=require(process.env.AZ_REACT_JSX_PATH);
const {renderToStaticMarkup}=require(process.env.AZ_REACT_DOM_SERVER_PATH);
function panel(calling){
 const file='artifacts/adventure-zone/src/components/calls/incoming-availability-control.tsx';
 const out=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};new Function('require','module','exports',out)(id=>{
 if(id==='react/jsx-runtime')return jsx;
 if(id==='@/features/calls/incoming-calling-context')return {useIncomingCalling:()=>calling};
 if(id==='@workspace/avz-crm/components/ui/button')return {Button:({variant,children,...props})=>React.createElement('button',props,children)};
 throw Error(id);},m,m.exports);
 return renderToStaticMarkup(React.createElement(m.exports.IncomingAvailabilityControl));
}
const calling=()=>({capability:{enabled:true},incoming:{state:'idle'},availability:{state:'ready',activeLease:true,audio:{inputs:[{deviceId:'voicemod',label:'Voicemod Virtual Microphone'}],outputs:[{deviceId:'headset',label:'Headphones'}],inputId:'voicemod',outputId:'headset',outputSupported:true,warning:''}},alertWarnings:[]});
test('available listener exposes selected Voicemod mic, real headset and call-speaker test',()=>{
 const html=panel(calling());assert.match(html,/Incoming call microphone/);assert.match(html,/value="voicemod" selected/);
 assert.match(html,/Incoming call speaker/);assert.match(html,/value="headset" selected/);assert.match(html,/Test call speaker/);assert.match(html,/Turn off releases the microphone/);
});
test('unsupported speaker routing is disabled and explained',()=>{
 const model=calling();model.availability.audio.outputSupported=false;model.availability.audio.outputId='';model.availability.audio.warning='This browser uses the system speaker.';
 const html=panel(model);assert.match(html,/aria-label="Incoming call speaker" disabled/);assert.match(html,/System speaker/);assert.match(html,/This browser uses the system speaker/);
});
test('retained lease after connection error still offers Turn off',()=>{
 const model=calling();model.availability.state='unavailable';assert.match(panel(model),/>Turn off</);
});
