import {config} from './config.js';
export const lengthOf=text=>Array.from(text).length;
export function validConfiguration(settings){try{const url=new URL(settings.createApplicationUrl);return url.protocol==='https:'&&url.hostname.endsWith('.supabase.co')&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/functions/v1/create-application'&&/^[A-Za-z0-9_]{5,32}$/.test(settings.botUsername);}catch{return false;}}
export function confirmationURL(value,bot){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.hostname!=='t.me'||url.port||url.username||url.password||url.hash||url.pathname.toLowerCase()!=='/'+bot.toLowerCase()||Array.from(url.searchParams.keys()).length!==1||!/^c_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('start')||''))throw Error('invalid_confirmation');
 return url.href;
}
export function fieldError(name,text){const value=text.trim(),n=lengthOf(value);const rules={name:[1,80,'Укажите имя: от 1 до 80 символов.'],subject:[1,120,'Укажите тему: от 1 до 120 символов.'],description:[5,2000,'Добавьте описание: от 5 до 2000 символов.']};const [min,max,message]=rules[name];return n<min||n>max?message:'';}
const errors={invalid_form:'Проверьте имя, тему и описание.',invalid_uuid:'Не удалось подготовить запрос. Обновите страницу, предварительно скопировав текст.',idempotency_conflict:'Содержимое запроса изменилось. Нажмите кнопку ещё раз, чтобы создать новый черновик.',draft_expired_or_confirmed:'Ссылка уже подтверждена или истекла. Если вы ещё не подтвердили обращение, нажмите кнопку повторно для новой ссылки.',ip_rate_limit:'Слишком много отправок. Подождите 10 минут и попробуйте снова.',daily_limit:'Сегодня достигнут лимит обращений. Попробуйте завтра.',server_not_configured:'Приём обращений ещё не настроен организатором. Ваш текст остался в форме.',origin_not_allowed:'Адрес сайта не разрешён обработчиком. Сообщите организатору.',client_address_unavailable:'Сервис пока не может обработать запрос. Попробуйте позже.',spam_rejected:'Не удалось отправить форму. Обновите страницу и попробуйте снова.',body_too_large:'Слишком большой запрос. Сократите текст.',invalid_confirmation:'Сервис вернул неподходящую ссылку. Не переходите по ней; сообщите организатору.'};
if(typeof document!=='undefined'){
 const form=document.getElementById('application-form'),submit=document.getElementById('submit'),errorBox=document.getElementById('request-error'),formStep=document.getElementById('form-step'),confirmStep=document.getElementById('confirmation-step'),link=document.getElementById('telegram-link'),expiry=document.getElementById('expiry');
 const ready=validConfiguration(config);let sending=false,attempt=null,expiryTimer=null;
 submit.disabled=!ready;document.getElementById('configuration-status').hidden=ready;
 const limits={name:80,subject:120,description:2000};
 function refresh(name,showError=false){const input=form.elements[name],counter=document.getElementById(name+'-count'),error=document.getElementById(name+'-error');const count=lengthOf(input.value);counter.textContent=count+' / '+limits[name];counter.classList.toggle('over',count>limits[name]);if(showError||input.getAttribute('aria-invalid')==='true'){const text=fieldError(name,input.value);error.textContent=text;input.setAttribute('aria-invalid',String(!!text));return !text;}return true;}
 for(const name of Object.keys(limits)){form.elements[name].addEventListener('input',()=>refresh(name));form.elements[name].addEventListener('blur',()=>refresh(name,true));}
 document.querySelectorAll('[data-topic]').forEach(a=>a.addEventListener('click',()=>{form.elements.subject.value=a.dataset.topic;refresh('subject');}));
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(sending||!ready)return;let firstInvalid=null;
  for(const name of Object.keys(limits))if(!refresh(name,true)&&!firstInvalid)firstInvalid=form.elements[name];if(firstInvalid){firstInvalid.focus();return;}
  const fields={name:form.elements.name.value.trim(),subject:form.elements.subject.value.trim(),description:form.elements.description.value.trim(),website:form.elements.website.value};
  const fingerprint=JSON.stringify(fields);if(!attempt||attempt.fingerprint!==fingerprint)attempt={fingerprint,request_id:crypto.randomUUID()};
  sending=true;submit.disabled=true;submit.textContent='Сохраняем черновик…';errorBox.hidden=true;form.setAttribute('aria-busy','true');
  try{
   const response=await fetch(config.createApplicationUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,request_id:attempt.request_id}),signal:AbortSignal.timeout(20000),credentials:'omit',cache:'no-store'});
   let data;try{data=await response.json();}catch{throw Error('service_unavailable');}
   if(!response.ok)throw Error(data.error||'service_unavailable');
   const verified=confirmationURL(data.confirmation_url,config.botUsername),until=Date.parse(data.expires_at);
   if(!Number.isFinite(until)||until<=Date.now()||until>Date.now()+35*60000)throw Error('invalid_confirmation');
   link.href=verified;link.removeAttribute('aria-disabled');link.textContent='Открыть бота в Telegram ↗';
   expiry.textContent='Ссылка действует до '+new Date(until).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'})+' МСК, не более 30 минут.';
   formStep.hidden=true;confirmStep.hidden=false;document.getElementById('confirmation-title').focus();
   clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>{link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.textContent='Срок ссылки истёк';expiry.textContent='Вернитесь к форме и создайте новую ссылку. Текст сохранён.';attempt=null;},until-Date.now());
  }catch(error){if(['idempotency_conflict','draft_expired_or_confirmed'].includes(error.message))attempt=null;errorBox.textContent=errors[error.message]||'Не удалось связаться с сервисом. Текст сохранён в форме. Проверьте соединение и попробуйте ещё раз.';errorBox.hidden=false;}
  finally{sending=false;submit.disabled=!ready;submit.textContent='Продолжить в Telegram ↗';form.removeAttribute('aria-busy');}
 });
 document.getElementById('back').addEventListener('click',()=>{confirmStep.hidden=true;formStep.hidden=false;clearTimeout(expiryTimer);form.elements.name.focus();});
}
