-- Wedding data is isolated from the diploma quiz. No anonymous table access.
create schema if not exists wedding_private;
revoke all on schema wedding_private from public,anon,authenticated;
create table if not exists wedding_private.responses (
  id uuid primary key, payload jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists wedding_private.settings (
  singleton boolean primary key default true check(singleton), admin_hash text not null
);
create table if not exists wedding_private.sessions (
  token_hash text primary key, expires_at timestamptz not null
);
revoke all on all tables in schema wedding_private from public,anon,authenticated;
alter table wedding_private.responses enable row level security;
alter table wedding_private.settings enable row level security;
alter table wedding_private.sessions enable row level security;

create or replace function public.wedding_status()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('ready',exists(select 1 from wedding_private.settings),'version','wedding-v1');
$$;

create or replace function public.wedding_submit(p_id uuid,p_payload jsonb,p_company text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare g jsonb; d jsonb; k text; v text; guests jsonb;
begin
  if p_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>30000
     or length(coalesce(p_company,''))>0 then
    raise exception 'Neplatný formulář' using errcode='22023';
  end if;
  foreach k in array array['attendance','contactName','email','phone','accommodation','transport','rideHome','accessibility','song','message'] loop
    if jsonb_typeof(p_payload->k) is distinct from 'string' then raise exception 'Neplatná položka formuláře' using errcode='22023'; end if;
  end loop;
  if p_payload->>'attendance' not in ('yes','no') or length(trim(p_payload->>'contactName')) not between 1 and 100
     or length(p_payload->>'email')>180 or length(p_payload->>'phone')>40
     or (length(trim(p_payload->>'email'))=0 and length(trim(p_payload->>'phone'))=0)
     or (p_payload->>'email'<>'' and p_payload->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
     or length(p_payload->>'accessibility')>1000 or length(p_payload->>'song')>200 or length(p_payload->>'message')>2000
     or p_payload->>'accommodation' not in ('yes','no','own','unsure')
     or p_payload->>'transport' not in ('car','ride','other','unsure')
     or p_payload->>'rideHome' not in ('yes','no','unsure')
     or jsonb_typeof(p_payload->'cars') is distinct from 'number'
     or p_payload->>'cars' !~ '^(0|[1-9]|1[0-2])$' then
    raise exception 'Zkontrolujte údaje formuláře' using errcode='22023';
  end if;
  guests:=p_payload->'guests';
  if jsonb_typeof(guests) is distinct from 'array' then raise exception 'Chybí seznam hostů' using errcode='22023'; end if;
  if (p_payload->>'attendance'='yes' and jsonb_array_length(guests) not between 1 and 12)
     or (p_payload->>'attendance'='no' and jsonb_array_length(guests)<>0) then
    raise exception 'Zkontrolujte počet hostů' using errcode='22023';
  end if;
  for g in select value from jsonb_array_elements(guests) loop
    if jsonb_typeof(g) is distinct from 'object' then raise exception 'Neplatný host' using errcode='22023'; end if;
    foreach k in array array['name','age','meal','allergies'] loop
      if jsonb_typeof(g->k) is distinct from 'string' then raise exception 'Neplatné údaje hosta' using errcode='22023'; end if;
    end loop;
    if length(trim(g->>'name')) not between 1 and 100 or length(g->>'allergies')>500
      or g->>'age' not in ('adult','child','baby') or g->>'meal' not in ('standard','vegetarian','vegan','child','none')
      or jsonb_typeof(g->'drinks') is distinct from 'array' then raise exception 'Neplatné údaje hosta' using errcode='22023'; end if;
    if jsonb_array_length(g->'drinks')>5 then raise exception 'Neplatná volba pití' using errcode='22023'; end if;
    for d in select value from jsonb_array_elements(g->'drinks') loop
      v:=d#>>'{}';
      if jsonb_typeof(d)<>'string' or v not in ('nonalcoholic','beer','wine','spirits','coffee')
         or (g->>'age'<>'adult' and v in ('beer','wine','spirits')) then
        raise exception 'Neplatná volba pití' using errcode='22023';
      end if;
    end loop;
  end loop;
  insert into wedding_private.responses(id,payload) values(p_id,p_payload)
    on conflict(id) do update set payload=excluded.payload,updated_at=clock_timestamp();
  return jsonb_build_object('saved',true);
end;
$$;

-- The random ID is a private edit capability stored only in the guest's browser.
create or replace function public.wedding_resume(p_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('payload',(select payload from wedding_private.responses where id=p_id));
$$;

create or replace function public.wedding_admin_login(p_password text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h text; t text;
begin
  if p_password is null or octet_length(p_password)>72 then return jsonb_build_object('error','Nesprávné heslo.'); end if;
  select admin_hash into h from wedding_private.settings;
  if h is null or __CRYPTO__.crypt(p_password,h)<>h then return jsonb_build_object('error','Nesprávné heslo.'); end if;
  delete from wedding_private.sessions where expires_at<now();
  t:=encode(__CRYPTO__.gen_random_bytes(32),'hex');
  insert into wedding_private.sessions values(encode(__CRYPTO__.digest(t,'sha256'),'hex'),now()+interval '4 hours');
  return jsonb_build_object('token',t);
end;
$$;
create or replace function wedding_private.require_admin(p_token text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_token is null or not exists(select 1 from wedding_private.sessions where
    token_hash=encode(__CRYPTO__.digest(p_token,'sha256'),'hex') and expires_at>now()) then
    raise exception 'Přihlaste se znovu.' using errcode='42501';
  end if;
end;
$$;
create or replace function public.wedding_admin_list(p_token text,p_after uuid default null,p_before timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; last_id uuid;
begin
  perform wedding_private.require_admin(p_token);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) into rows from
    (select * from wedding_private.responses where (p_after is null or id>p_after) and created_at<=p_before order by id limit 200) r;
  last_id:=(rows->-1->>'id')::uuid;
  return jsonb_build_object('responses',rows,'as_of',p_before,'next',case when exists(
    select 1 from wedding_private.responses where id>last_id and created_at<=p_before) then last_id else null end);
end;
$$;
create or replace function public.wedding_admin_delete(p_token text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform wedding_private.require_admin(p_token);
  delete from wedding_private.responses where id=p_id;
  return jsonb_build_object('deleted',true);
end;
$$;
create or replace function public.wedding_admin_logout(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  delete from wedding_private.sessions where token_hash=encode(__CRYPTO__.digest(p_token,'sha256'),'hex');
  return jsonb_build_object('success',true);
end;
$$;
revoke all on function wedding_private.require_admin(text) from public,anon,authenticated;
revoke all on function public.wedding_status(),public.wedding_submit(uuid,jsonb,text),public.wedding_resume(uuid),
  public.wedding_admin_login(text),public.wedding_admin_list(text,uuid,timestamptz),public.wedding_admin_delete(text,uuid),public.wedding_admin_logout(text)
  from public,anon,authenticated;
grant execute on function public.wedding_status(),public.wedding_submit(uuid,jsonb,text),public.wedding_resume(uuid),
  public.wedding_admin_login(text),public.wedding_admin_list(text,uuid,timestamptz),public.wedding_admin_delete(text,uuid),public.wedding_admin_logout(text)
  to anon,authenticated;
notify pgrst,'reload schema';
