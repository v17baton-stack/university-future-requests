import fs from 'node:fs';
import path from 'node:path';
const output=path.resolve('.local/dashboard');fs.mkdirSync(output,{recursive:true});const core=fs.readFileSync('supabase/functions/_shared/core.js','utf8');
for(const name of ['create-application','telegram-hook','setup-telegram']){const entry=fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8').replace(/^import .*?;\r?\n/m,'');const file=core+'\n'+entry;if(/^import /m.test(file))throw Error('Unexpected dependency');fs.writeFileSync(path.join(output,name+'.ts'),file);}
console.log('Созданы три автономных файла функций в .local/dashboard (без секретов).');
