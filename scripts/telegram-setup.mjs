import {readLocal} from './local-env.mjs';
const env=readLocal(),action=process.argv[2]||'status';
if(!['register','status','test'].includes(action))throw Error('Действие: register, status или test.');
if(!env.SUPABASE_URL||!env.SETUP_SECRET)throw Error('Не настроены локальные SUPABASE_URL / SETUP_SECRET.');
const url=new URL('/functions/v1/setup-telegram',env.SUPABASE_URL);if(url.protocol!=='https:')throw Error('Требуется HTTPS.');
const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Secret':env.SETUP_SECRET},body:JSON.stringify({action}),signal:AbortSignal.timeout(30000)});
const data=await res.json();if(!res.ok)throw Error('Облачная настройка: '+(data.error||res.status));
// Response contract deliberately contains no token or secret.
console.log(JSON.stringify(data,null,2));
