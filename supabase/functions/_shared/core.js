export class AppError extends Error { constructor(code,status=400){super(code);this.code=code;this.status=status;} }
const encoder=new TextEncoder();
export const charLength=value=>Array.from(value).length;
export function serverKey(env){
 if(env.SERVER_DB_KEY)return env.SERVER_DB_KEY;
 if(env.SUPABASE_SECRET_KEYS){
  let keys;try{keys=JSON.parse(env.SUPABASE_SECRET_KEYS);}catch{if(env.SUPABASE_SECRET_KEYS.startsWith('sb_secret_'))return env.SUPABASE_SECRET_KEYS;}
  if(keys&&typeof keys==='object'&&!Array.isArray(keys)){if(typeof keys.default==='string'&&keys.default)return keys.default;const value=Object.values(keys).find(v=>typeof v==='string'&&v);if(value)return value;}
 }
 if(env.SUPABASE_SERVICE_ROLE_KEY)return env.SUPABASE_SERVICE_ROLE_KEY;
 throw new AppError('server_not_configured',503);
}
export function rpcHeaders(key){const h={'Content-Type':'application/json',apikey:key};if(!key.startsWith('sb_secret_'))h.Authorization='Bearer '+key;return h;}
export function rpcClient(env,fetcher=fetch){
 const key=serverKey(env);const url=new URL(env.SUPABASE_URL||'');if(url.protocol!=='https:')throw new AppError('server_not_configured',503);
 return async(name,args={})=>{
  let res;try{res=await fetcher(url.origin+'/rest/v1/rpc/'+name,{method:'POST',headers:rpcHeaders(key),body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});}catch{throw new AppError('database_unavailable',503);}
  let data;try{data=await res.json();}catch{throw new AppError('database_unavailable',503);}
  if(!res.ok){const msg=String(data?.message||'');const known=['idempotency_conflict','draft_expired_or_confirmed','ip_rate_limit','daily_limit','invalid_form','prompt_binding_not_ready'];const code=known.find(x=>msg.includes(x))||'database_unavailable';throw new AppError(code,['ip_rate_limit','daily_limit'].includes(code)?429:code==='idempotency_conflict'?409:code==='prompt_binding_not_ready'||code==='database_unavailable'?503:400);}
  return data;
 };
}
export async function sha256(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
export async function confirmationCode(uuid,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const raw=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(uuid)));return btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function safeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length<1||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function readJSON(req,max){
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new AppError('json_required',415);
 if(Number(req.headers.get('content-length')||0)>max)throw new AppError('body_too_large',413);
 const reader=req.body?.getReader();if(!reader)throw new AppError('invalid_json');let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new AppError('body_too_large',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
 try{const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!obj||Array.isArray(obj)||typeof obj!=='object')throw 0;return obj;}catch{throw new AppError('invalid_json');}
}
export function validateForm(raw){
 for(const [key,min,max] of [['name',1,80],['subject',1,120],['description',5,2000]])if(typeof raw[key]!=='string'||charLength(raw[key].trim())<min||charLength(raw[key].trim())>max)throw new AppError('invalid_form');
 if(typeof raw.request_id!=='string'||! /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(raw.request_id))throw new AppError('invalid_uuid');
 if(typeof raw.website!=='string'||raw.website!=='')throw new AppError('spam_rejected');
 return {name:raw.name.trim(),subject:raw.subject.trim(),description:raw.description.trim(),request_id:raw.request_id.toLowerCase()};
}
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function errorResponse(error,headers={}){return json({error:error instanceof AppError?error.code:'service_unavailable'},error instanceof AppError?error.status:503,headers);}
function siteOrigin(env){try{const url=new URL(env.SITE_URL);if(url.protocol!=='https:'||url.username||url.password)throw 0;return url.origin;}catch{throw new AppError('server_not_configured',503);}}
export function createApplicationHandler(env,deps={}){
 return async req=>{let headers={};try{
  const origin=siteOrigin(env);if(req.headers.get('origin')!==origin)return json({error:'origin_not_allowed'},403);
  headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')throw new AppError('method_not_allowed',405);
  if(!/^[A-Za-z0-9_]{5,32}$/.test(env.BOT_USERNAME||'')||!/^[1-9]\d{0,15}$/.test(env.ADMIN_CHAT_ID||'')||!env.BOT_TOKEN||!env.FORM_SECRET||env.FORM_SECRET.length<32)throw new AppError('server_not_configured',503);
  const raw=await readJSON(req,16000),form=validateForm(raw);
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  if(!ip||!/^[a-f\d.:]{3,64}$/i.test(ip))throw new AppError('client_address_unavailable',503);
  const code=await confirmationCode(form.request_id,env.FORM_SECRET),codeHash=await sha256(code),ipHash=await confirmationCode('ip:'+ip,env.FORM_SECRET);
  const rpc=deps.rpc||rpcClient(env,deps.fetch);const result=await rpc('nr_create_draft',{p_request_key:form.request_id,p_name:form.name,p_subject:form.subject,p_description:form.description,p_code_hash:codeHash,p_ip_hash:await sha256(ipHash)});
  return json({confirmation_url:`https://t.me/${env.BOT_USERNAME}?start=c_${code}`,expires_at:result.expires_at},200,headers);
 }catch(e){return errorResponse(e,headers);}};
}
export function normalizeUpdate(update,botId){
 if(!Number.isSafeInteger(update.update_id)||update.update_id<0)throw new AppError('invalid_update');
 const callback=update.callback_query;const message=callback?.message||update.message;const from=callback?.from||message?.from;
 if(!message||!from||message.chat?.type!=='private'||from.is_bot!==false||!Number.isSafeInteger(from.id)||from.id<=0||from.id!==message.chat.id)throw new AppError('unsupported_update');
 if(callback&&(typeof callback.id!=='string'||callback.id.length>200||typeof callback.data!=='string'||callback.data.length>64||message.from?.id!==botId))throw new AppError('invalid_callback');
 const text=callback?'':message.text||'';if(typeof text!=='string'||charLength(text)>2100)throw new AppError('message_too_large');
 return {update_id:update.update_id,actor:from.id,chat:message.chat.id,private:true,is_bot:false,text,callback:callback?.data||'',reply_to:message.reply_to_message?.message_id||null,reply_to_our_bot:message.reply_to_message?.from?.id===botId,callback_id:callback?.id};
}
export function telegramTransport(env,fetcher=fetch){
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(env.BOT_TOKEN||''))throw new AppError('bot_not_configured',503);
 return async(method,payload)=>{let response;try{response=await fetcher(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});}catch{throw new AppError('TG_NETWORK',503);}let body;try{body=await response.json();}catch{throw new AppError('TG_INVALID_RESPONSE',503);}if(!response.ok||body.ok!==true)throw new AppError('TG_'+(body.error_code||response.status),503);return body.result;};
}
export async function flushOutbox(rpc,tg,{deadline=Date.now()+18000}={}){
 let batches=0;while(Date.now()<deadline&&batches++<8){const jobs=await rpc('nr_claim_outbox',{p_limit:1});if(!jobs.length)break;
  for(const job of jobs){let result;try{result=await tg('sendMessage',job.payload);}catch(e){await rpc('nr_failed',{p_id:job.id,p_lease_token:job.lease_token,p_error_code:e instanceof AppError?e.code:'TG_ERROR'});continue;}
   // Do not convert an uncertain DB acknowledgement into a Telegram failure.
   // An unacknowledged success stays leased and is recovered after expiry.
   const recorded=await rpc('nr_delivered',{p_id:job.id,p_lease_token:job.lease_token,p_telegram_message_id:result.message_id});if(!recorded)throw new AppError('lease_lost',503);
  }
 }
 const pending=await rpc('nr_pending_count');return {pending:Number(pending.pending)+Number(pending.processing),failed:Number(pending.failed)};
}
export function telegramHookHandler(env,deps={}){
 return async req=>{try{
  if(!env.TG_WEBHOOK_SECRET||!safeEqual(req.headers.get('x-telegram-bot-api-secret-token'),env.TG_WEBHOOK_SECRET))return json({error:'unauthorized'},401);
  if(req.method!=='POST')throw new AppError('method_not_allowed',405);
  const raw=await readJSON(req,32000);let event;
  try{event=normalizeUpdate(raw,Number((env.BOT_TOKEN||'').split(':')[0]));}catch(e){if(e.code==='unsupported_update'||e.code==='message_too_large'||e.code==='invalid_callback')return json({ok:true,ignored:true});throw e;}
  const code=event.text.match(/^\/start(?:@[A-Za-z0-9_]+)? c_([A-Za-z0-9_-]{43})$/)?.[1];if(code)event.start_hash=await sha256(code);
  const rpc=deps.rpc||rpcClient(env,deps.fetch),tg=deps.telegram||telegramTransport(env,deps.fetch);
  await rpc('nr_handle_update',{p_event:event,p_admin:/^[1-9]\d*$/.test(env.ADMIN_CHAT_ID||'')?Number(env.ADMIN_CHAT_ID):0,p_site_url:env.SITE_URL||''});
  if(event.callback_id){try{await tg('answerCallbackQuery',{callback_query_id:event.callback_id});}catch{/* Stale callback acknowledgement is not a delivery success. */}}
  const result=await flushOutbox(rpc,tg);if(result.pending)return json({error:'delivery_in_progress'},503);return json({ok:true});
 }catch(e){return errorResponse(e);}};
}
export function setupTelegramHandler(env,deps={}){
 return async req=>{try{
  if(!env.SETUP_SECRET||!safeEqual(req.headers.get('x-setup-secret'),env.SETUP_SECRET))return json({error:'unauthorized'},401);
  if(req.method!=='POST')throw new AppError('method_not_allowed',405);const raw=await readJSON(req,1000);
  const tg=deps.telegram||telegramTransport(env,deps.fetch);const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:')throw new AppError('invalid_configuration',503);
  const hook=base.origin+'/functions/v1/telegram-hook';
  if(raw.action==='register'){
   if(!/^[A-Za-z0-9_-]{32,256}$/.test(env.TG_WEBHOOK_SECRET||''))throw new AppError('invalid_webhook_secret',503);
   const me=await tg('getMe',{});if(me.username?.toLowerCase()!==env.BOT_USERNAME?.toLowerCase())throw new AppError('bot_username_mismatch',409);
   await tg('setWebhook',{url:hook,secret_token:env.TG_WEBHOOK_SECRET,allowed_updates:['message','callback_query'],drop_pending_updates:false,max_connections:10});
   await tg('setMyName',{name:'Университет будущего'});await tg('setMyDescription',{description:'Вопросы и предложения к конференции «Университет будущего» 19 марта 2027. Отправьте форму на сайте и подтвердите обращение. Ответ организатора придёт сюда.'});
   await tg('setMyCommands',{commands:[{command:'my',description:'Мои обращения'},{command:'id',description:'Мой Telegram ID'},{command:'requests',description:'Обращения — для организатора'},{command:'retry',description:'Ошибки доставки — для организатора'}]});
   return json({registered:true});
  }
  if(raw.action==='status'){const info=await tg('getWebhookInfo',{});return json({url:info.url,correct_url:info.url===hook,pending_updates:info.pending_update_count||0,last_error_date:info.last_error_date||null,last_error_present:!!info.last_error_message});}
  if(raw.action==='test'){if(!/^[1-9]\d*$/.test(env.ADMIN_CHAT_ID||''))throw new AppError('owner_not_verified',409);const result=await tg('sendMessage',{chat_id:Number(env.ADMIN_CHAT_ID),text:'Контроль подключения · Университет будущего. Это проверочное сообщение, а не заявка участника. /requests — обращения, /my — ваши обращения.'});return json({test_sent:true,message_id:result.message_id});}
  throw new AppError('unknown_action');
 }catch(e){return errorResponse(e);}};
}
