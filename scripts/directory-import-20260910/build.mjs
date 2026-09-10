import fs from 'node:fs/promises';
const seed=JSON.stringify(JSON.parse(await fs.readFile(new URL('./seed.json',import.meta.url),'utf8')));
if(seed.includes('$seed$'))throw new Error('SQL delimiter found in seed');
const template=await fs.readFile(new URL('./import-template.sql',import.meta.url),'utf8');
await fs.writeFile(new URL('../../lib/db/migrations/20260910_public_directory_leads.sql',import.meta.url),template.replace('__SEED__',seed));
