import fs from 'node:fs';
const seed=JSON.parse(fs.readFileSync(new URL('./seed.json', import.meta.url)));
if(seed.length!==285) throw new Error(`expected 285 records, got ${seed.length}`);
if(new Set(seed.map(r=>r.sourceKey)).size!==seed.length) throw new Error('source keys must be unique');
if(seed.filter(r=>r.group.includes('fair/festival')).length!==135) throw new Error('fair count');
if(seed.filter(r=>r.group.includes('service')).length!==150) throw new Error('service count');
if(seed.some(r=>!r.source.startsWith('https://www.rmaf.net/business/'))) throw new Error('unexpected source');
console.log('RMAF online directory seed checks passed');
