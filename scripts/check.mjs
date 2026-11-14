import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
for(const file of walk('public')){
 if(!/\.(html|css|js|svg|ics)$/.test(file))continue;const text=fs.readFileSync(file,'utf8');
 assert(!/(?:sb_secret_[A-Za-z0-9_-]{10,}|\b\d{6,}:[A-Za-z0-9_-]{25,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]+\.)/.test(text),'Secret-like content in '+file);
 assert(!/(?:BOT_TOKEN|SERVER_DB_KEY|SERVICE_ROLE_KEY|ADMIN_CHAT_ID|TG_WEBHOOK_SECRET|SETUP_SECRET|FORM_SECRET)/.test(text),'Server-only setting in '+file);
 if(file.endsWith('.html'))for(const m of text.matchAll(/(?:src|href)="([^"]+)"/g)){const target=m[1];if(/^(?:https?:|mailto:|tel:|#)/.test(target))continue;assert(!target.startsWith('/'),'Root absolute asset path');assert(fs.existsSync(path.resolve('public',target)),'Missing asset '+target);}
}
for(const file of [...walk('scripts'),...walk('public'),...walk('tests'),...walk('supabase/functions')].filter(f=>/\.(mjs|js)$/.test(f))){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
const config=await import('../public/config.js');assert.deepEqual(Object.keys(config.config).sort(),['botUsername','createApplicationUrl']);
const toml=fs.readFileSync('supabase/config.toml','utf8');assert.equal((toml.match(/verify_jwt = false/g)||[]).length,3);
const ignore=fs.readFileSync('.gitignore','utf8');for(const rule of ['.local/','.env','supabase/.temp/'])assert(ignore.includes(rule));
console.log('PASS: синтаксис, относительные ресурсы, публичные файлы, настройки функций и исключения Git.');
