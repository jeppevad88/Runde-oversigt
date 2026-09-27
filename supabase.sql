-- U11 Holdfordeler - Supabase database
-- Kør hele scriptet i Supabase SQL Editor.
-- Appen bruger ingen login/auth. Derfor er læse/skrive-adgang åben via anon/publishable key.
-- Det er bevidst for et fælles internt holdværktøj. Del derfor ikke projektets service_role key.

create table if not exists public.u11_rosters (
  round_no integer not null,
  team_id text not null,
  players jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (round_no, team_id)
);

create or replace function public.set_u11_rosters_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists u11_rosters_updated_at on public.u11_rosters;
create trigger u11_rosters_updated_at
before update on public.u11_rosters
for each row execute function public.set_u11_rosters_updated_at();

alter table public.u11_rosters enable row level security;

drop policy if exists "U11 public read" on public.u11_rosters;
create policy "U11 public read"
on public.u11_rosters
for select
to anon
using (true);

drop policy if exists "U11 public insert" on public.u11_rosters;
create policy "U11 public insert"
on public.u11_rosters
for insert
to anon
with check (true);

drop policy if exists "U11 public update" on public.u11_rosters;
create policy "U11 public update"
on public.u11_rosters
for update
to anon
using (true)
with check (true);

drop policy if exists "U11 public delete" on public.u11_rosters;
create policy "U11 public delete"
on public.u11_rosters
for delete
to anon
using (true);
