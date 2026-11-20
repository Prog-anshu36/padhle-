-- Run in the Supabase SQL editor, then enable Realtime for public.rooms.
create table if not exists public.rooms (
  id text primary key,
  video_id text,
  current_time double precision not null default 0,
  playback_speed double precision not null default 1,
  is_playing boolean not null default false,
  last_action text not null default 'created',
  last_updated_at timestamptz not null default now(),
  last_actor_id text,
  event_id uuid not null default gen_random_uuid(),
  notes text not null default '',
  timer_end_at timestamptz,
  timer_duration integer not null default 1500,
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create table if not exists public.messages (id uuid primary key,room_id text references public.rooms(id) on delete cascade,sender_id text not null,sender_name text not null,message text not null check(char_length(message)<=400),created_at timestamptz not null default now());
create table if not exists public.bookmarks (id uuid primary key,room_id text references public.rooms(id) on delete cascade,label text not null,video_time double precision not null,created_by_name text not null,created_at timestamptz not null default now());
alter table public.rooms enable row level security;alter table public.messages enable row level security;alter table public.bookmarks enable row level security;
create policy "anonymous rooms read" on public.rooms for select using (expires_at > now());
create policy "anonymous messages read" on public.messages for select using (exists(select 1 from public.rooms r where r.id=room_id and r.expires_at>now()));
create policy "anonymous messages insert" on public.messages for insert with check (exists(select 1 from public.rooms r where r.id=room_id and r.expires_at>now()));
create policy "anonymous bookmarks read" on public.bookmarks for select using (exists(select 1 from public.rooms r where r.id=room_id and r.expires_at>now()));
create policy "anonymous bookmarks insert" on public.bookmarks for insert with check (exists(select 1 from public.rooms r where r.id=room_id and r.expires_at>now()));
create or replace function public.join_room(p_room_id text,p_expires_at timestamptz) returns public.rooms language plpgsql security definer set search_path=public as $$ declare r public.rooms; begin insert into rooms(id,expires_at) values(upper(p_room_id),p_expires_at) on conflict(id) do update set expires_at=greatest(rooms.expires_at,excluded.expires_at) returning * into r; return r; end $$;
create or replace function public.update_room_state(p_room_id text,p_event_id uuid,p_actor_id text,p_video_id text,p_current_time double precision,p_playback_speed double precision,p_is_playing boolean,p_last_action text,p_notes text,p_timer_end_at timestamptz,p_timer_duration integer) returns public.rooms language plpgsql security definer set search_path=public as $$ declare r public.rooms; begin update rooms set video_id=p_video_id,current_time=greatest(0,p_current_time),playback_speed=p_playback_speed,is_playing=p_is_playing,last_action=p_last_action,last_updated_at=now(),last_actor_id=p_actor_id,event_id=p_event_id,notes=p_notes,timer_end_at=p_timer_end_at,timer_duration=p_timer_duration where id=upper(p_room_id) and expires_at>now() returning * into r; return r; end $$;
grant execute on function public.join_room(text,timestamptz) to anon;grant execute on function public.update_room_state(text,uuid,text,text,double precision,double precision,boolean,text,text,timestamptz,integer) to anon;
alter publication supabase_realtime add table public.rooms;
-- Optional daily cleanup: delete from rooms where expires_at < now();

