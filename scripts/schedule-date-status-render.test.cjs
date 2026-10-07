const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ts=require(process.env.AZ_TYPESCRIPT_PATH);
const React=require(process.env.AZ_REACT_PATH),jsx=require(process.env.AZ_REACT_JSX_PATH);
const {renderToStaticMarkup}=require(process.env.AZ_REACT_DOM_SERVER_PATH);
const cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file);
 const out=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 new Function('require','module','exports',out)(id=>{
  if(id==='react/jsx-runtime')return jsx;
  if(id==='wouter')return {Link:({href,children,...props})=>React.createElement('a',{href,...props},children)};
  if(id==='@/features/calendar/schedule-date-status')return load('artifacts/adventure-zone/src/features/calendar/schedule-date-status.ts');
  throw Error('Unexpected dependency '+id);
 },m,m.exports);cache.set(file,m.exports);return m.exports;
}
const {ScheduleDateIssues}=load('artifacts/adventure-zone/src/components/schedule/schedule-date-issues.tsx');
const provenance={rawPublic:{start:'2026-08-06T17:00:00Z',end:'2026-08-08T17:00:00Z'},rawReservation:{start:null,end:null},publicWindow:null,reservationWindow:null,evidenceState:'needs_review',reviewReasons:['INCOMPLETE_PUBLIC_WINDOW']};
const saved={id:'saved',name:'<Saved event>',organizationId:'profile',startsAt:null,dateProvenance:provenance};
test('calendar date checks distinguish saved dates from missing ones and expose review navigation',()=>{
 const html=renderToStaticMarkup(React.createElement(ScheduleDateIssues,{season:'2026',events:[saved,{id:'missing',name:'Missing event',startsAt:null},{id:'ready',name:'Ready event',startsAt:new Date('2026-08-06T17:00:00Z')}]}));
 assert.match(html,/1 need review/);assert.match(html,/1 missing dates/);
 assert.match(html,/Dates need review/);assert.match(html,/Needs dates/);
 assert.match(html,/Aug 6, 2026/);assert.match(html,/Aug 8, 2026/);
 assert.match(html,/unverified/);assert.match(html,/&lt;Saved event&gt;/);
 assert.match(html,/\/settings\/event-date-coverage\?bookingId=saved/);
 assert.match(html,/\/profiles\/profile\?bookingId=saved&amp;season=2026/);
 assert.doesNotMatch(html,/Ready event/);
});
test('boss schedule shows saved dates with profile navigation but no owner repair control',()=>{
 const html=renderToStaticMarkup(React.createElement(ScheduleDateIssues,{events:[saved],profileBasePath:'/boss/profiles',readOnly:true}));
 assert.match(html,/\/boss\/profiles\/profile\?bookingId=saved/);
 assert.match(html,/Aug 6, 2026/);assert.match(html,/Dates need review/);
 assert.doesNotMatch(html,/event-date-coverage/);
});
test('date checks disappear when every displayed event has dates without review work',()=>{
 assert.equal(renderToStaticMarkup(React.createElement(ScheduleDateIssues,{events:[{id:'ready',startsAt:new Date('2026-08-06T17:00:00Z')}]})),'');
});
