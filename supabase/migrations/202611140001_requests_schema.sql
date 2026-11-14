begin;
create schema requests_app;
revoke all on schema requests_app from public, anon, authenticated;

create table requests_app.tickets (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 request_key uuid not null unique, content_hash text not null, name text not null check(char_length(name) between 1 and 80),
 subject text not null check(char_length(subject) between 1 and 120), description text not null check(char_length(description) between 5 and 2000),
 status text not null default 'draft' check(status in ('draft','new','in_progress','done')),
 code_hash text not null unique, expires_at timestamptz not null default now()+interval '30 minutes',
 chat_id bigint, ip_hash text not null, created_at timestamptz not null default now(), confirmed_at timestamptz,
 check((status='draft' and chat_id is null) or (status<>'draft' and chat_id is not null))
);
create index tickets_recent on requests_app.tickets(created_at);
create index tickets_chat on requests_app.tickets(chat_id,number);
create table requests_app.messages (
 id uuid primary key default gen_random_uuid(), position bigint generated always as identity unique, ticket_id uuid not null references requests_app.tickets(id),
 sender_id bigint not null, sender_role text not null check(sender_role in('owner','applicant','system')),
 body text not null check(char_length(body) between 1 and 2000), created_at timestamptz not null default now(),
 delivery text not null default 'pending' check(delivery in('pending','sent','failed'))
);
create table requests_app.updates (update_id bigint primary key, actor_id bigint not null, created_at timestamptz not null default now());
create index updates_actor on requests_app.updates(actor_id,created_at);
create table requests_app.outbox (
 id uuid primary key default gen_random_uuid(), position bigint generated always as identity unique, effect_key text not null unique, chat_id bigint not null,
 ticket_id uuid references requests_app.tickets(id), message_id uuid references requests_app.messages(id),
 kind text not null default 'message' check(kind in('message','prompt','receipt','card')),
 payload jsonb not null, status text not null default 'pending' check(status in('pending','processing','sent','failed')),
 attempts int not null default 0, error_code text, lease_token uuid, leased_until timestamptz,
 telegram_message_id bigint, created_at timestamptz not null default now(), sent_at timestamptz,
 check((status='processing' and lease_token is not null and leased_until is not null) or status<>'processing')
);
create index outbox_delivery on requests_app.outbox(status,created_at);
create index messages_ticket_history on requests_app.messages(ticket_id,position);
create index outbox_ticket on requests_app.outbox(ticket_id);
create index outbox_source_message on requests_app.outbox(message_id);
create table requests_app.prompts (
 chat_id bigint not null, prompt_message_id bigint not null, ticket_id uuid not null references requests_app.tickets(id),
 actor_id bigint not null, created_at timestamptz not null default now(), primary key(chat_id,prompt_message_id)
);
create index prompts_ticket on requests_app.prompts(ticket_id);

alter table requests_app.tickets enable row level security;
alter table requests_app.messages enable row level security;
alter table requests_app.updates enable row level security;
alter table requests_app.outbox enable row level security;
alter table requests_app.prompts enable row level security;
revoke all on all tables in schema requests_app from public,anon,authenticated;
revoke all on all sequences in schema requests_app from public,anon,authenticated;
alter default privileges in schema requests_app revoke all on tables from public,anon,authenticated;
alter default privileges in schema requests_app revoke all on sequences from public,anon,authenticated;
alter default privileges in schema requests_app revoke execute on functions from public;
commit;
