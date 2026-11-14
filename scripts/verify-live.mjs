import fs from 'node:fs';
import {readLocal} from './local-env.mjs';
const env=readLocal();
if(!env.SUPABASE_URL)throw Error('Сначала подтвердите собственный проект и настройте его URL.');
const base=new URL('/functions/v1/',env.SUPABASE_URL).href;
const results=[];
for(const name of ['telegram-hook','setup-telegram']){
 const response=await fetch(base+name,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
 const payload=await response.json();results.push({function:name,status:response.status,expected:401,passed:response.status===401&&payload.error==='unauthorized'});
}
fs.mkdirSync('.local',{recursive:true});fs.writeFileSync('.local/live-http-verification.json',JSON.stringify({at:new Date().toISOString(),results,telegramAcceptance:false},null,2));
console.log(JSON.stringify(results));if(results.some(r=>!r.passed))process.exitCode=1;
