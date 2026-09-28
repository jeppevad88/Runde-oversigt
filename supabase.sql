-- U11 Holdfordeler bruger den eksisterende public.u11_state-tabel.
-- Denne fil opretter ikke en ny roster-tabel.
-- Kør kun nedenstående, hvis du mangler public.u11_state eller vil sikre policies.

create table if not exists public.u11_state (
  id text primary key,
  state jsonb not null default '{"rounds":{},"updatedAt":null}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.u11_state (id, state)
values ('main', '{"rounds":{},"updatedAt":null}'::jsonb)
on conflict (id) do nothing;

alter table public.u11_state enable row level security;

drop policy if exists "U11 state public read" on public.u11_state;
drop policy if exists "U11 state public insert" on public.u11_state;
drop policy if exists "U11 state public update" on public.u11_state;

create policy "U11 state public read"
on public.u11_state for select to anon using (true);

create policy "U11 state public insert"
on public.u11_state for insert to anon with check (true);

create policy "U11 state public update"
on public.u11_state for update to anon using (true) with check (true);

notify pgrst, 'reload schema';
