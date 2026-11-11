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
test('a selected season separates older date clues without losing their repair links',()=>{
 const current={...saved,id:'current',name:'Current setup review',dateProvenance:{...provenance,rawPublic:{start:'2027-07-21T06:00:00Z',end:'2027-07-26T05:59:59Z'}}};
 const old={...saved,id:'old',name:'Historical mixed-year review',dateProvenance:{...provenance,rawPublic:{start:'2009-08-05',end:'2009-08-05'},rawReservation:{start:'2026-08-03',end:'2026-08-10'}}};
 const html=renderToStaticMarkup(React.createElement(ScheduleDateIssues,{season:'2027',events:[old,current]}));
 assert.match(html,/Date checks \(1\)/);
 assert.match(html,/Other-season date reviews \(1\)/);
 assert.ok(html.indexOf('Current setup review')<html.indexOf('Other-season date reviews'));
 assert.ok(html.indexOf('Historical mixed-year review')>html.indexOf('Other-season date reviews'));
 assert.match(html,/event-date-coverage\?bookingId=old/);
 assert.doesNotMatch(html,/bookingId=old&amp;season=2027/);
});
test('unknown and cross-year reviews remain in the current season queue',()=>{
 const cross={...saved,id:'cross',name:'Cross-year access',dateProvenance:{...provenance,rawPublic:{start:'2026-12-31',end:'2027-01-02'}}};
 const sentinel={...saved,id:'sentinel',name:'Open-ended import',dateProvenance:{...provenance,rawPublic:{start:'2026-01-01',end:'9999-12-31'}}};
 const html=renderToStaticMarkup(React.createElement(ScheduleDateIssues,{season:'2027',events:[cross,sentinel,{id:'unknown',name:'Unknown season',startsAt:null}]}));
 assert.match(html,/Date checks \(3\)/);
 assert.doesNotMatch(html,/Other-season date reviews/);
 assert.match(html,/Unknown season/); assert.match(html,/Open-ended import/);
});
