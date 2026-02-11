-- Supabase schema + RLS policies

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1,
  total_rooms int not null default 4,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  name text not null,
  start_date date not null,
  end_date date not null,
  rooms int not null,
  guests text
);

create table if not exists public.groceries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  title text not null,
  owner text,
  completed boolean not null default false
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users,
  title text not null,
  owner text,
  completed boolean not null default false
);

create table if not exists public.reservation_guests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  name text not null,
  count int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users
);

create table if not exists public.reservation_notes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users
);

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.reservations enable row level security;
alter table public.groceries enable row level security;
alter table public.todos enable row level security;
alter table public.reservation_guests enable row level security;
alter table public.reservation_notes enable row level security;

-- Profiles policies
create policy "Profiles: select own" on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "Profiles: insert own" on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "Profiles: update own" on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Settings policies
create policy "Settings: select" on public.settings
for select
to authenticated
using (true);

create policy "Settings: update admin" on public.settings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Reservations policies
create policy "Reservations: select" on public.reservations
for select
to authenticated
using (true);

create policy "Reservations: insert" on public.reservations
for insert
to authenticated
with check (created_by = auth.uid());

create policy "Reservations: update owner or admin" on public.reservations
for update
to authenticated
using (created_by = auth.uid() or public.is_admin())
with check (created_by = auth.uid() or public.is_admin());

create policy "Reservations: delete owner or admin" on public.reservations
for delete
to authenticated
using (created_by = auth.uid() or public.is_admin());

-- Groceries policies
create policy "Groceries: select" on public.groceries
for select
to authenticated
using (true);

create policy "Groceries: insert" on public.groceries
for insert
to authenticated
with check (created_by = auth.uid());

create policy "Groceries: update owner or admin" on public.groceries
for update
to authenticated
using (created_by = auth.uid() or public.is_admin())
with check (created_by = auth.uid() or public.is_admin());

create policy "Groceries: delete owner or admin" on public.groceries
for delete
to authenticated
using (created_by = auth.uid() or public.is_admin());

-- Todos policies
create policy "Todos: select" on public.todos
for select
to authenticated
using (true);

create policy "Todos: insert" on public.todos
for insert
to authenticated
with check (created_by = auth.uid());

create policy "Todos: update owner or admin" on public.todos
for update
to authenticated
using (created_by = auth.uid() or public.is_admin())
with check (created_by = auth.uid() or public.is_admin());

create policy "Todos: delete owner or admin" on public.todos
for delete
to authenticated
using (created_by = auth.uid() or public.is_admin());

-- Reservation guests policies
create policy "Reservation guests: select" on public.reservation_guests
for select
to authenticated
using (
  exists (
    select 1
    from public.reservations r
    where r.id = reservation_guests.reservation_id
  )
);

create policy "Reservation guests: insert editor or admin" on public.reservation_guests
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.reservations r
    where r.id = reservation_guests.reservation_id
      and (r.created_by = auth.uid() or public.is_admin())
  )
);

create policy "Reservation guests: delete owner or admin" on public.reservation_guests
for delete
to authenticated
using (created_by = auth.uid() or public.is_admin());

-- Reservation notes policies
create policy "Reservation notes: select" on public.reservation_notes
for select
to authenticated
using (
  exists (
    select 1
    from public.reservations r
    where r.id = reservation_notes.reservation_id
  )
);

create policy "Reservation notes: insert editor or admin" on public.reservation_notes
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.reservations r
    where r.id = reservation_notes.reservation_id
      and (r.created_by = auth.uid() or public.is_admin())
  )
);

create policy "Reservation notes: delete owner or admin" on public.reservation_notes
for delete
to authenticated
using (created_by = auth.uid() or public.is_admin());

-- seed settings row if missing
insert into public.settings (id, total_rooms)
values (1, 4)
on conflict (id) do nothing;
