import fs from 'node:fs/promises';
const seed = JSON.stringify(JSON.parse(await fs.readFile(new URL('./seed.json', import.meta.url), 'utf8')));
if (seed.includes('$seed$')) throw new Error('SQL delimiter found in seed');
const template = await fs.readFile(new URL('./import-template.sql', import.meta.url), 'utf8');
const sql = template.replaceAll('public-directories-20260910-v1', 'rmaf-online-directory-20260910-v1').replace('__SEED__', seed);
await fs.writeFile(new URL('../../lib/db/migrations/20260910_rmaf_online_directory.sql', import.meta.url), sql);
