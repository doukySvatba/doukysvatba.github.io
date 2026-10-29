-- Apply after supabase.sql. Mail stays disabled until deployment and SMTP tests pass.
create table if not exists wedding_private.mail_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false, worker_url text not null default '',
  worker_key text not null, daily_cap integer not null default 100 check(daily_cap between 1 and 500),
  hourly_cap integer not null default 30 check(hourly_cap between 1 and 100)
);
alter table wedding_private.responses add column if not exists mail_revision bigint not null default 1;
create table if not exists wedding_private.mail_queue (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references wedding_private.responses(id) on delete cascade,
  revision bigint not null, recipient text not null, content jsonb not null,
  status text not null default 'queued' check(status in ('queued','sending','sent','retry','failed','cancelled')),
  attempts integer not null default 0, created_at timestamptz not null default now(),
  next_attempt timestamptz not null default now(), locked_until timestamptz, lease uuid,
  sent_at timestamptz, last_attempt timestamptz, error_code text,
  unique(response_id,revision)
);
create table if not exists wedding_private.mail_attempts (id uuid primary key default gen_random_uuid(), attempted_at timestamptz not null default now());
alter table wedding_private.mail_attempts enable row level security;
revoke all on wedding_private.mail_attempts from public,anon,authenticated;
create index if not exists wedding_mail_attempt_time on wedding_private.mail_attempts(attempted_at);
create index if not exists wedding_mail_due on wedding_private.mail_queue(status,next_attempt);
create index if not exists wedding_mail_recipient on wedding_private.mail_queue(recipient,last_attempt);
alter table wedding_private.mail_config enable row level security;
alter table wedding_private.mail_queue enable row level security;
revoke all on wedding_private.mail_config,wedding_private.mail_queue from public,anon,authenticated;

create or replace function wedding_private.mail_version()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    new.mail_revision:=old.mail_revision+case when new.payload is distinct from old.payload then 1 else 0 end;
  end if;
  return new;
end;
$$;
drop trigger if exists wedding_mail_version on wedding_private.responses;
create trigger wedding_mail_version before update on wedding_private.responses for each row execute function wedding_private.mail_version();

create or replace function wedding_private.enqueue_mail()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient text;
begin
  if tg_op='UPDATE' and new.payload is not distinct from old.payload then return new; end if;
  update wedding_private.mail_queue set status='cancelled' where response_id=new.id and status in ('queued','retry');
  recipient:=lower(trim(new.payload->>'email'));
  if coalesce(recipient,'')='' or not exists(select 1 from wedding_private.mail_config where enabled) then return new; end if;
  insert into wedding_private.mail_queue(response_id,revision,recipient,content) values(new.id,new.mail_revision,recipient,
    jsonb_build_object('contactName',new.payload->>'contactName','attendance',new.payload->>'attendance',
      'names',(select coalesce(jsonb_agg(g->>'name'),'[]'::jsonb) from jsonb_array_elements(new.payload->'guests') g),
      'updated',tg_op='UPDATE'));
  return new;
end;
$$;
drop trigger if exists wedding_mail_enqueue on wedding_private.responses;
create trigger wedding_mail_enqueue after insert or update of payload on wedding_private.responses for each row execute function wedding_private.enqueue_mail();

create or replace function wedding_private.require_mailer(p_key text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_key is null or not exists(select 1 from wedding_private.mail_config
    where __CRYPTO__.digest(worker_key,'sha256')=__CRYPTO__.digest(p_key,'sha256')) then
    raise exception 'Unauthorized mail worker' using errcode='42501';
  end if;
end;
$$;

create or replace function public.wedding_mail_claim(p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job wedding_private.mail_queue; cfg wedding_private.mail_config;
begin
  perform wedding_private.require_mailer(p_key);
  select * into cfg from wedding_private.mail_config where enabled for update;
  if not found then return null; end if;
  update wedding_private.mail_queue set status='failed',error_code='delivery_unknown'
    where status='sending' and locked_until<now() and attempts>=5;
  update wedding_private.mail_queue q set status='cancelled' where (status in ('queued','retry') or (status='sending' and locked_until<now())) and exists(
    select 1 from wedding_private.responses r where r.id=q.response_id and r.mail_revision<>q.revision);
  -- These are our own conservative safety caps, NOT advertised Seznam limits.
  if (select count(*) from wedding_private.mail_attempts where attempted_at>now()-interval '24 hours')>=cfg.daily_cap
     or (select count(*) from wedding_private.mail_attempts where attempted_at>now()-interval '1 hour')>=cfg.hourly_cap then return null; end if;
  select * into job from wedding_private.mail_queue q where
    ((q.status in ('queued','retry') and q.next_attempt<=now()) or (q.status='sending' and q.locked_until<now()))
    and q.attempts<5 and exists(select 1 from wedding_private.responses r where r.id=q.response_id and r.mail_revision=q.revision)
    and not exists(select 1 from wedding_private.mail_queue other where other.id<>q.id and other.recipient=q.recipient and other.last_attempt>now()-interval '10 minutes')
    order by q.created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update wedding_private.mail_queue set status='sending',attempts=attempts+1,lease=gen_random_uuid(),
    locked_until=now()+interval '5 minutes',last_attempt=now() where id=job.id returning * into job;
  insert into wedding_private.mail_attempts default values;
  delete from wedding_private.mail_attempts where attempted_at<now()-interval '7 days';
  return jsonb_build_object('id',job.id,'lease',job.lease,'recipient',job.recipient,'content',job.content);
end;
$$;

create or replace function public.wedding_mail_finish(p_key text,p_id uuid,p_lease uuid,p_sent boolean,p_retry boolean default true,p_error text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform wedding_private.require_mailer(p_key);
  update wedding_private.mail_queue set status=case when p_sent then 'sent' when p_retry and attempts<5 then 'retry' else 'failed' end,
    sent_at=case when p_sent then now() else null end,error_code=case when p_sent then null else left(coalesce(p_error,'smtp_error'),60) end,
    next_attempt=now()+make_interval(secs=>least(3600,60*power(2,attempts)::integer)),locked_until=null
    where id=p_id and lease=p_lease and status='sending';
  return jsonb_build_object('updated',found);
end;
$$;

create or replace function wedding_private.mail_state(p_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('enabled',coalesce((select enabled from wedding_private.mail_config),false),
    'status',case when coalesce(r.payload->>'email','')='' then 'no_email' else coalesce(q.status,'not_queued') end,
    'sent_at',q.sent_at,'attempts',coalesce(q.attempts,0),'error',q.error_code)
    from wedding_private.responses r left join wedding_private.mail_queue q on q.response_id=r.id and q.revision=r.mail_revision where r.id=p_id;
$$;
create or replace function public.wedding_mail_status(p_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select coalesce(wedding_private.mail_state(p_id),jsonb_build_object('enabled',coalesce((select enabled from wedding_private.mail_config),false),'status','not_queued'));
$$;
create or replace function public.wedding_admin_list(p_token text,p_after uuid default null,p_before timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; last_id uuid;
begin
  perform wedding_private.require_admin(p_token);
  select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('email',wedding_private.mail_state(r.id)) order by r.id),'[]'::jsonb) into rows from
    (select * from wedding_private.responses where (p_after is null or id>p_after) and created_at<=p_before order by id limit 200) r;
  last_id:=(rows->-1->>'id')::uuid;
  return jsonb_build_object('responses',rows,'as_of',p_before,'next',case when exists(
    select 1 from wedding_private.responses where id>last_id and created_at<=p_before) then last_id else null end);
end;
$$;
create or replace function public.wedding_admin_retry_mail(p_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform wedding_private.require_admin(p_token);
  update wedding_private.mail_queue q set status='retry',attempts=0,next_attempt=now(),error_code=null where
    q.response_id=p_id and q.status='failed' and exists(select 1 from wedding_private.responses r where r.id=p_id and r.mail_revision=q.revision);
  return jsonb_build_object('queued',found);
end;
$$;
-- pg_net is asynchronous: SMTP never runs in the registration transaction.
create or replace function wedding_private.dispatch_mail()
returns void language plpgsql security definer set search_path='' as $$
declare cfg wedding_private.mail_config;
begin
  select * into cfg from wedding_private.mail_config where enabled;
  if not found or cfg.worker_url='' then return; end if;
  if not exists(select 1 from wedding_private.mail_queue where
    (status in ('queued','retry') and next_attempt<=now()) or (status='sending' and locked_until<now())) then return; end if;
  perform net.http_post(url:=cfg.worker_url,headers:=jsonb_build_object('Content-Type','application/json','x-wedding-worker-key',cfg.worker_key),
    body:='{"mode":"run"}'::jsonb,timeout_milliseconds:=90000);
end;
$$;
revoke all on function wedding_private.mail_version(),wedding_private.enqueue_mail(),wedding_private.require_mailer(text),
  wedding_private.mail_state(uuid),wedding_private.dispatch_mail() from public,anon,authenticated;
revoke all on function public.wedding_mail_claim(text),public.wedding_mail_finish(text,uuid,uuid,boolean,boolean,text),
  public.wedding_mail_status(uuid),public.wedding_admin_retry_mail(text,uuid) from public,anon,authenticated;
grant execute on function public.wedding_mail_claim(text),public.wedding_mail_finish(text,uuid,uuid,boolean,boolean,text),
  public.wedding_mail_status(uuid),public.wedding_admin_retry_mail(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
