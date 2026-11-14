begin;
create function requests_app.enqueue(p_key text,p_chat bigint,p_text text,p_keyboard jsonb default null,p_ticket uuid default null,p_kind text default 'message',p_message uuid default null)
returns void language plpgsql set search_path=pg_catalog,requests_app as $$
begin
 insert into requests_app.outbox(effect_key,chat_id,ticket_id,message_id,kind,payload)
 values(p_key,p_chat,p_ticket,p_message,p_kind,jsonb_strip_nulls(jsonb_build_object('chat_id',p_chat,'text',p_text,'reply_markup',p_keyboard)))
 on conflict(effect_key) do nothing;
end $$;

create function requests_app.card(p_ticket uuid,p_actor bigint,p_admin bigint,p_key text)
returns void language plpgsql set search_path=pg_catalog,requests_app as $$
declare t requests_app.tickets; k jsonb; s text;
begin
 select * into t from requests_app.tickets where id=p_ticket and status<>'draft';
 if not found or (p_actor<>p_admin and t.chat_id<>p_actor) then
 perform requests_app.enqueue(p_key,p_actor,'Обращение недоступно. Выберите своё обращение: /my.');return;end if;
 s:=case t.status when 'new' then 'Новая' when 'in_progress' then 'В работе' else 'Завершена' end;
 if p_actor=p_admin then
 k:=jsonb_build_object('inline_keyboard',jsonb_build_array(
 jsonb_build_array(jsonb_build_object('text','Ответить','callback_data','reply:'||t.id),jsonb_build_object('text','История','callback_data','history:'||t.id||':0')),
 jsonb_build_array(jsonb_build_object('text','В работу','callback_data','progress:'||t.id),jsonb_build_object('text','Завершить','callback_data','done:'||t.id)),
 jsonb_build_array(jsonb_build_object('text','К списку','callback_data','list:all:0'))));
 else
 k:=jsonb_build_object('inline_keyboard',jsonb_build_array(
 jsonb_build_array(jsonb_build_object('text','Написать уточнение','callback_data','reply:'||t.id)),
 jsonb_build_array(jsonb_build_object('text','История','callback_data','history:'||t.id||':0'),jsonb_build_object('text','Мои обращения','callback_data','my:0'))));
 end if;
 perform requests_app.enqueue(p_key,p_actor,'Обращение №'||t.number||E'\n'||t.name||E'\nТема: '||t.subject||E'\n\n'||t.description||E'\n\nСтатус: '||s,k,t.id,'card');
end $$;

create function requests_app.list_tickets(p_actor bigint,p_admin bigint,p_filter text,p_page int,p_key text,p_mine boolean default false)
returns void language plpgsql set search_path=pg_catalog,requests_app as $$
declare rows jsonb:='[]'::jsonb; t record; has_more boolean; count_rows int:=0; page int:=greatest(0,least(coalesce(p_page,0),100000));
begin
 if not p_mine and p_actor<>p_admin then perform requests_app.enqueue(p_key,p_actor,'Этот раздел доступен только организатору. Ваши обращения: /my.');return;end if;
 if p_filter not in('all','new','in_progress') then p_filter:='all';end if;
 if not p_mine then rows:=rows||jsonb_build_array(jsonb_build_array(
 jsonb_build_object('text','Новые','callback_data','list:new:0'),jsonb_build_object('text','В работе','callback_data','list:in_progress:0'),jsonb_build_object('text','Все','callback_data','list:all:0')));end if;
 for t in select id,number,subject,status from requests_app.tickets where status<>'draft'
 and (not p_mine or chat_id=p_actor) and (p_filter='all' or status=p_filter)
 order by number desc limit 8 offset page*8 loop
 rows:=rows||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','#'||t.number||' · '||left(t.subject,34),'callback_data','card:'||t.id)));count_rows:=count_rows+1;end loop;
 select exists(select 1 from requests_app.tickets where status<>'draft' and (not p_mine or chat_id=p_actor) and(p_filter='all' or status=p_filter) order by number desc limit 1 offset (page+1)*8) into has_more;
 if page>0 then rows:=rows||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','← Назад','callback_data',case when p_mine then 'my:' else 'list:'||p_filter||':' end||(page-1))));end if;
 if has_more then rows:=rows||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Далее →','callback_data',case when p_mine then 'my:' else 'list:'||p_filter||':' end||(page+1))));end if;
 perform requests_app.enqueue(p_key,p_actor,case when count_rows=0 then 'Обращений в этом разделе пока нет.' else case when p_mine then 'Ваши обращения' else 'Обращения' end||' · страница '||(page+1) end,jsonb_build_object('inline_keyboard',rows));
end $$;

create function public.nr_create_draft(p_request_key uuid,p_name text,p_subject text,p_description text,p_code_hash text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,requests_app as $$
declare t requests_app.tickets; fingerprint text;
begin
 if p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_subject is null or char_length(btrim(p_subject)) not between 1 and 120 or p_description is null or char_length(btrim(p_description)) not between 5 and 2000 or p_request_key is null or p_code_hash !~ '^[a-f0-9]{64}$' or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_form' using errcode='P0001';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(btrim(p_name),btrim(p_subject),btrim(p_description))::text,'UTF8')),'hex');
 lock table requests_app.tickets in share row exclusive mode;
 select * into t from requests_app.tickets where request_key=p_request_key;
 if found then
 if t.content_hash<>fingerprint then raise exception 'idempotency_conflict' using errcode='P0001';end if;
 if t.expires_at<now() or t.status<>'draft' then raise exception 'draft_expired_or_confirmed' using errcode='P0001';end if;
 return jsonb_build_object('expires_at',t.expires_at);end if;
 delete from requests_app.tickets where status='draft' and created_at<now()-interval '1 day';
 if(select count(*) from requests_app.tickets where ip_hash=p_ip_hash and created_at>now()-interval '10 minutes')>=10 then raise exception 'ip_rate_limit' using errcode='P0001';end if;
 if(select count(*) from requests_app.tickets where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=500 then raise exception 'daily_limit' using errcode='P0001';end if;
 insert into requests_app.tickets(request_key,content_hash,name,subject,description,code_hash,ip_hash) values(p_request_key,fingerprint,btrim(p_name),btrim(p_subject),btrim(p_description),p_code_hash,p_ip_hash) returning * into t;
 return jsonb_build_object('expires_at',t.expires_at);
end $$;

create function public.nr_handle_update(p_event jsonb,p_admin bigint,p_site_url text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,requests_app as $$
declare actor bigint:=(p_event->>'actor')::bigint; uid bigint:=(p_event->>'update_id')::bigint;
 text_value text:=coalesce(p_event->>'text',''); callback text:=coalesce(p_event->>'callback',''); key text; t requests_app.tickets;
 pr requests_app.prompts; reply_id bigint; start_code_hash text; action text; ticket_arg text; target uuid; row record; kb jsonb; msg uuid; page int; offset_n int; next_exists boolean; owner boolean:=false;
begin
 if actor is null or actor<=0 or uid is null or (p_event->>'chat')::bigint is distinct from actor or p_event->>'private' is distinct from 'true' or p_event->>'is_bot' is distinct from 'false' then raise exception 'invalid_actor';end if;
 owner:=p_admin>0 and actor=p_admin;
 insert into requests_app.updates(update_id,actor_id) values(uid,actor) on conflict do nothing;
 if not found then return jsonb_build_object('duplicate',true);end if;
 key:='u:'||uid;
 if(select count(*) from requests_app.updates where actor_id=actor and created_at>now()-interval '10 seconds')>30 then
 perform requests_app.enqueue('limit:'||actor||':'||floor(extract(epoch from now())/10),actor,'Слишком много действий. Подождите несколько секунд.');return '{"limited":true}';end if;
 if char_length(text_value)>2100 or char_length(callback)>64 then perform requests_app.enqueue(key,actor,'Сообщение слишком длинное. Допустимо до 2000 символов.');return '{}';end if;

 if text_value~'^/id(@[A-Za-z0-9_]+)?$' then perform requests_app.enqueue(key,actor,'Ваш Telegram ID: '||actor);return '{}';end if;
 if text_value~'^/start(@[A-Za-z0-9_]+)? c_[A-Za-z0-9_-]{43}$' then
 start_code_hash:=p_event->>'start_hash';select * into t from requests_app.tickets where tickets.code_hash=start_code_hash for update;
 if not found then perform requests_app.enqueue(key,actor,'Ссылка недействительна. Вернитесь к форме и создайте новое обращение.');return '{}';end if;
 if t.status<>'draft' then
 if t.chat_id=actor then perform requests_app.card(t.id,actor,p_admin,key);else perform requests_app.enqueue(key,actor,'Ссылка уже использована. Создайте собственное обращение на сайте.');end if;return '{}';end if;
 if t.expires_at<now() then perform requests_app.enqueue(key,actor,'Срок ссылки истёк (30 минут). Вернитесь на сайт и отправьте форму ещё раз.');return '{}';end if;
 if p_admin<=0 then perform requests_app.enqueue(key,actor,'Приём обращений пока не настроен. Попробуйте позже.');return '{}';end if;
 update requests_app.tickets set status='new',chat_id=actor,confirmed_at=now() where id=t.id;
 perform requests_app.enqueue(key||':ok',actor,'Ваше обращение принято. Номер: '||t.number||E'.\nОтвет организатора придёт в этот чат. Ваши обращения: /my.');
 perform requests_app.card(t.id,p_admin,p_admin,key||':owner');return '{}';end if;
 if text_value~'^/my(@[A-Za-z0-9_]+)?$' then perform requests_app.list_tickets(actor,p_admin,'all',0,key,true);return '{}';end if;
 if text_value~'^/requests(@[A-Za-z0-9_]+)?$' then perform requests_app.list_tickets(actor,p_admin,'new',0,key,false);return '{}';end if;
 if text_value~'^/retry(@[A-Za-z0-9_]+)?$' or callback='failures' then
 if not owner then perform requests_app.enqueue(key,actor,'Команда доступна только организатору.');return '{}';end if;
 kb:='[]'::jsonb;for row in select id,error_code from requests_app.outbox where status='failed' order by created_at desc limit 8 loop
 kb:=kb||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Повторить · '||coalesce(row.error_code,'ошибка'),'callback_data','retry:'||row.id)));end loop;
 perform requests_app.enqueue(key,actor,case when kb='[]'::jsonb then 'Ошибок доставки нет.' else 'Ошибки доставки (до 8 последних). Сначала устраните причину, затем повторите.' end,jsonb_build_object('inline_keyboard',kb));return '{}';end if;

 if callback<>'' then
 action:=split_part(callback,':',1);ticket_arg:=split_part(callback,':',2);
 if action='list' then
 page:=case when split_part(callback,':',3)~'^\d{1,6}$' then split_part(callback,':',3)::int else 0 end;
 perform requests_app.list_tickets(actor,p_admin,ticket_arg,page,key,false);return '{}';end if;
 if action='my' then page:=case when ticket_arg~'^\d{1,6}$' then ticket_arg::int else 0 end;perform requests_app.list_tickets(actor,p_admin,'all',page,key,true);return '{}';end if;
 if ticket_arg !~ '^[a-f0-9-]{36}$' then perform requests_app.enqueue(key,actor,'Кнопка недействительна. Откройте список заново.');return '{}';end if;
 begin target:=ticket_arg::uuid;exception when invalid_text_representation then perform requests_app.enqueue(key,actor,'Кнопка недействительна.');return '{}';end;
 if action='retry' then
 if not owner then perform requests_app.enqueue(key,actor,'Недостаточно прав.');return '{}';end if;
 update requests_app.outbox set status='pending',lease_token=null,leased_until=null,error_code=null where id=target and status='failed';
 if found then perform requests_app.enqueue(key,actor,'Повтор поставлен в очередь. Это ещё не подтверждение доставки.');else perform requests_app.enqueue(key,actor,'Запись уже отправлена или находится в обработке.');end if;return '{}';end if;
 select * into t from requests_app.tickets where id=target and status<>'draft' for update;
 if not found or(not owner and t.chat_id<>actor) then perform requests_app.enqueue(key,actor,'Обращение недоступно. Ваш список: /my.');return '{}';end if;
 if action='card' then perform requests_app.card(t.id,actor,p_admin,key);return '{}';end if;
 if action='progress' or action='done' then
 if not owner then perform requests_app.enqueue(key,actor,'Изменять статус может только организатор.');return '{}';end if;
 update requests_app.tickets set status=case when action='progress' then 'in_progress' else 'done' end where id=t.id;
 insert into requests_app.messages(ticket_id,sender_id,sender_role,body,delivery) values(t.id,actor,'system',case when action='progress' then 'Статус: В работе' else 'Статус: Завершена' end,'sent');
 perform requests_app.card(t.id,actor,p_admin,key||':card');
 perform requests_app.enqueue(key||':status',t.chat_id,'Обращение №'||t.number||': '||case when action='progress' then 'В работе' else 'Завершено. История сохранена.' end,null,t.id);return '{}';end if;
 if action='history' then
 page:=case when split_part(callback,':',3)~'^\d{1,6}$' then split_part(callback,':',3)::int else 0 end;offset_n:=page*5;
 for row in select * from requests_app.messages where ticket_id=t.id order by position limit 5 offset offset_n loop
 perform requests_app.enqueue(key||':h:'||row.id,actor,to_char(row.created_at at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI')||' МСК · '||case row.sender_role when 'owner' then 'Организатор' when 'system' then 'Статус' else 'Заявитель' end||E'\n'||row.body||case when row.sender_role='system' then '' else E'\nДоставка: '||case row.delivery when 'sent' then 'подтверждена Telegram' when 'failed' then 'ошибка' else 'в очереди' end end,null,t.id);end loop;
 select exists(select 1 from requests_app.messages where ticket_id=t.id order by position limit 1 offset offset_n+5) into next_exists;
 kb:=jsonb_build_array(jsonb_build_array(jsonb_build_object('text','К обращению','callback_data','card:'||t.id)));
 if page>0 then kb:=kb||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','← Предыдущие','callback_data','history:'||t.id||':'||(page-1))));end if;
 if next_exists then kb:=kb||jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Следующие →','callback_data','history:'||t.id||':'||(page+1))));end if;
 perform requests_app.enqueue(key||':end',actor,'История обращения №'||t.number||' · страница '||(page+1),jsonb_build_object('inline_keyboard',kb),t.id);return '{}';end if;
 if action='reply' then
 perform requests_app.enqueue(key,actor,'Ответ по обращению №'||t.number||E'.\nОтветьте именно на это сообщение текстом до 2000 символов. Не указывайте пароли и платёжные реквизиты.',jsonb_build_object('force_reply',true,'selective',true,'input_field_placeholder','Ответьте на эту подсказку'),t.id,'prompt');return '{}';end if;
 perform requests_app.enqueue(key,actor,'Кнопка устарела. Откройте /my или /requests.');return '{}';end if;

 if p_event->>'reply_to' is not null then
 reply_id:=(p_event->>'reply_to')::bigint;
 select * into pr from requests_app.prompts where chat_id=actor and prompt_message_id=reply_id;
 if not found then
 if p_event->>'reply_to_our_bot'='true' and exists(select 1 from requests_app.outbox where chat_id=actor and kind='prompt' and status in('processing','pending')) then raise exception 'prompt_binding_not_ready' using errcode='40001';end if;
 perform requests_app.enqueue(key,actor,'Не удалось связать ответ с обращением. Откройте его и нажмите «Ответить» или «Написать уточнение».');return '{}';end if;
 select * into t from requests_app.tickets where id=pr.ticket_id and status<>'draft' for update;
 if not found or pr.actor_id<>actor or(not owner and t.chat_id<>actor) then perform requests_app.enqueue(key,actor,'Недостаточно прав для ответа.');return '{}';end if;
 if char_length(text_value) not between 1 and 2000 then perform requests_app.enqueue(key,actor,'Нужен текст от 1 до 2000 символов. Вложения и голосовые не поддерживаются.');return '{}';end if;
 insert into requests_app.messages(ticket_id,sender_id,sender_role,body) values(t.id,actor,case when owner then 'owner' else 'applicant' end,text_value) returning id into msg;
 perform requests_app.enqueue(key||':deliver',case when owner then t.chat_id else p_admin end,'Обращение №'||t.number||case when owner then E' · ответ организатора\n' else E' · уточнение заявителя\n' end||text_value,jsonb_build_object('inline_keyboard',jsonb_build_array(jsonb_build_array(jsonb_build_object('text','Открыть обращение','callback_data','card:'||t.id)))),t.id,'message',msg);
 perform requests_app.enqueue(key||':saved',actor,'Сообщение сохранено и поставлено в очередь. Подтверждение доставки — отдельным сообщением.',null,t.id,'receipt');return '{}';end if;

 perform requests_app.enqueue(key,actor,'Университет будущего · 19 марта 2027. Чтобы отправить обращение, заполните форму на сайте и нажмите «Запустить» по ссылке подтверждения. Ваши обращения: /my. ID: /id.'||case when owner then E'\nОрганизатору: /requests и /retry.' else '' end||case when p_site_url<>'' then E'\n'||p_site_url else '' end);return '{}';
end $$;

create function public.nr_claim_outbox(p_limit int default 8)
returns jsonb language plpgsql security definer set search_path=pg_catalog,requests_app as $$
declare result jsonb;
begin
 with candidates as(select id from requests_app.outbox where status='pending' or(status='processing' and leased_until<now()) order by position for update skip locked limit greatest(1,least(p_limit,12))),
 claimed as(update requests_app.outbox o set status='processing',lease_token=gen_random_uuid(),leased_until=now()+interval '90 seconds',attempts=attempts+1 from candidates c where o.id=c.id returning o.*)
 select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;return result;
end $$;

create function public.nr_delivered(p_id uuid,p_lease_token uuid,p_telegram_message_id bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,requests_app as $$
declare job requests_app.outbox; source requests_app.messages;
begin
 update requests_app.outbox set status='sent',sent_at=now(),telegram_message_id=p_telegram_message_id,error_code=null,lease_token=null,leased_until=null
 where id=p_id and status='processing' and lease_token=p_lease_token returning * into job;
 if not found then return false;end if;
 if job.kind='prompt' then
 if p_telegram_message_id is null then raise exception 'missing_prompt_id';end if;
 insert into requests_app.prompts(chat_id,prompt_message_id,ticket_id,actor_id) values(job.chat_id,p_telegram_message_id,job.ticket_id,job.chat_id) on conflict do nothing;
 end if;
 if job.message_id is not null then
 update requests_app.messages set delivery='sent' where id=job.message_id returning * into source;
 perform requests_app.enqueue('delivered:'||job.id,source.sender_id,'Telegram подтвердил доставку вашего сообщения по обращению №'||(select number from requests_app.tickets where id=job.ticket_id)||'.',null,job.ticket_id,'receipt');end if;
 return true;
end $$;

create function public.nr_failed(p_id uuid,p_lease_token uuid,p_error_code text)
returns boolean language plpgsql security definer set search_path=pg_catalog,requests_app as $$
declare job requests_app.outbox;
begin
 update requests_app.outbox set status='failed',error_code=left(p_error_code,80),lease_token=null,leased_until=null where id=p_id and status='processing' and lease_token=p_lease_token returning * into job;
 if not found then return false;end if;
 if job.message_id is not null then update requests_app.messages set delivery='failed' where id=job.message_id;end if;return true;
end $$;

create function public.nr_pending_count() returns jsonb language sql security definer set search_path=pg_catalog,requests_app as $$
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'processing',count(*) filter(where status='processing'),'failed',count(*) filter(where status='failed')) from requests_app.outbox;
$$;

revoke all on all functions in schema requests_app from public,anon,authenticated;
revoke all on function public.nr_create_draft(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.nr_handle_update(jsonb,bigint,text) from public,anon,authenticated;
revoke all on function public.nr_claim_outbox(int) from public,anon,authenticated;
revoke all on function public.nr_delivered(uuid,uuid,bigint) from public,anon,authenticated;
revoke all on function public.nr_failed(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.nr_pending_count() from public,anon,authenticated;
grant execute on function public.nr_create_draft(uuid,text,text,text,text,text),public.nr_handle_update(jsonb,bigint,text),public.nr_claim_outbox(int),public.nr_delivered(uuid,uuid,bigint),public.nr_failed(uuid,uuid,text),public.nr_pending_count() to service_role;
commit;
