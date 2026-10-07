const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'artifacts/adventure-zone/src/features/calendar/schedule-date-status.ts'),'utf8');
const {scheduleDateStatus}=new Function(stripTypeScriptTypes(source.replace(/^export /gm,''),{mode:'strip'})+';return {scheduleDateStatus};')();
const dates={rawPublic:{start:'2026-08-06T17:00:00.000Z',end:'2026-08-08T17:00:00.000Z'},rawReservation:{start:null,end:null},publicWindow:null,reservationWindow:null,evidenceState:'needs_review',reviewReasons:['INCOMPLETE_PUBLIC_WINDOW']};
test('saved but unverified dates are review work, not missing dates',()=>{
 const event={startsAt:null,dateProvenance:dates};const before=JSON.stringify(event);
 const result=scheduleDateStatus(event);
 assert.equal(result.kind,'review');
 assert.match(result.details.join(' '),/Aug 6, 2026/);
 assert.match(result.details.join(' '),/Aug 8, 2026/);
 assert.equal(JSON.stringify(event),before);
 assert.equal(event.startsAt,null);
});
test('genuinely missing dates remain missing',()=>{
 assert.equal(scheduleDateStatus({startsAt:null}).kind,'missing');
 assert.equal(scheduleDateStatus({startsAt:null,dateProvenance:{...dates,rawPublic:{start:null,end:null}}}).kind,'missing');
});
test('verified public dates with unresolved travel dates still identify review work',()=>{
 const result=scheduleDateStatus({startsAt:new Date('2027-07-21T06:00:00Z'),dateProvenance:{...dates,rawPublic:{start:'2027-07-21T06:00:00Z',end:'2027-07-26T05:59:59.999Z'},publicWindow:{start:'2027-07-21T06:00:00Z',end:'2027-07-26T05:59:59.999Z'},rawReservation:{start:'2027-07-21T17:00:00Z',end:'2027-07-25T17:00:00Z'},reviewReasons:['INCOMPLETE_RESERVATION_WINDOW']}});
 assert.equal(result.kind,'review');
 assert.match(result.label,/Travel/);
 assert.match(result.details.join(' '),/Jul 25, 2027/);
});
test('invalid dates and import sentinels are not displayed as real dates',()=>{
 const result=scheduleDateStatus({startsAt:null,dateProvenance:{...dates,rawPublic:{start:'garbage',end:'9999-12-31T00:00:00Z'}}});
 assert.equal(result.kind,'missing');
 assert.doesNotMatch(result.details.join(' '),/9999|Invalid Date/);
});
test('one saved endpoint stays visibly incomplete',()=>{
 const result=scheduleDateStatus({startsAt:null,dateProvenance:{...dates,rawPublic:{start:'2026-08-06T17:00:00Z',end:null}}});
 assert.equal(result.kind,'review');
 assert.match(result.details.join(' '),/End not recorded/);
});
test('verified dates and existing dated records need no missing-date warning',()=>{
 assert.equal(scheduleDateStatus({startsAt:new Date('2026-08-06T17:00:00Z')}).kind,'ready');
 assert.equal(scheduleDateStatus({startsAt:new Date('2026-08-06T17:00:00Z'),dateProvenance:{...dates,evidenceState:'verified'}}).kind,'ready');
});
