-- ============================================================
-- SunEscape Vacation House Planner — Supabase Schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS
-- ============================================================

-- ─── Tables ──────────────────────────────────────────────────

-- User profiles (extends auth.users)
create table if not exists public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  email           text,
  full_name       text,
  role            text not null default 'member',
  push_subscription jsonb,
  created_at      timestamptz not null default now()
);

-- House-wide settings (singleton row id=1)
create table if not exists public.settings (
  id          int primary key default 1,
  total_rooms int not null default 5,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users
);

-- Reservations
create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid not null references auth.users,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  rooms       int not null,
  guests      text
);

-- Groceries shared list
create table if not exists public.groceries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid not null references auth.users,
  title       text not null,
  owner       text,
  completed   boolean not null default false
);

-- To-Do shared list
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid not null references auth.users,
  title       text not null,
  owner       text,
  completed   boolean not null default false
);

-- Reservation guests (named people in a reservation, added by creator)
create table if not exists public.reservation_guests (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references public.reservations(id) on delete cascade,
  name            text not null,
  count           int not null default 1,
  created_at      timestamptz not null default now(),
  created_by      uuid not null references auth.users
);

-- Reservation notes
create table if not exists public.reservation_notes (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references public.reservations(id) on delete cascade,
  note            text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid not null references auth.users
);

-- Invites: broadcast from a reservation creator to all other users
create table if not exists public.invites (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references public.reservations(id) on delete cascade,
  created_by      uuid not null references auth.users,
  created_at      timestamptz not null default now(),
  message         text
);

-- Invite responses: tracks accept / decline + how many rooms the joiner needs
-- When a user accepts, the app also creates a new reservation for them.
create table if not exists public.invite_responses (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references public.invites(id) on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  status      text not null check (status in ('accepted', 'declined')),
  rooms_count int not null default 1,
  created_at  timestamptz not null default now(),
  unique (invite_id, user_id)
);

-- Legacy invite_dismissals kept for backward compatibility
create table if not exists public.invite_dismissals (
  invite_id   uuid not null references public.invites(id) on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (invite_id, user_id)
);

-- ─── Helper function ─────────────────────────────────────────

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ─── Row Level Security ──────────────────────────────────────

alter table public.profiles          enable row level security;
alter table public.settings          enable row level security;
alter table public.reservations      enable row level security;
alter table public.groceries         enable row level security;
alter table public.todos             enable row level security;
alter table public.reservation_guests enable row level security;
alter table public.reservation_notes enable row level security;
alter table public.invites           enable row level security;
alter table public.invite_responses  enable row level security;
alter table public.invite_dismissals enable row level security;

-- ── Profiles ──
drop policy if exists "Profiles: select own"           on public.profiles;
drop policy if exists "Profiles: select authenticated" on public.profiles;
drop policy if exists "Profiles: insert own"           on public.profiles;
drop policy if exists "Profiles: update own"           on public.profiles;

-- All authenticated users can read all profiles (needed for invite/guest display names)
create policy "Profiles: select authenticated" on public.profiles
  for select to authenticated using (true);

create policy "Profiles: insert own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy "Profiles: update own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- ── Settings ──
drop policy if exists "Settings: select"       on public.settings;
drop policy if exists "Settings: update admin" on public.settings;

create policy "Settings: select" on public.settings
  for select to authenticated using (true);

create policy "Settings: update admin" on public.settings
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Reservations ──
drop policy if exists "Reservations: select"               on public.reservations;
drop policy if exists "Reservations: insert"               on public.reservations;
drop policy if exists "Reservations: update owner or admin" on public.reservations;
drop policy if exists "Reservations: delete owner or admin" on public.reservations;

create policy "Reservations: select" on public.reservations
  for select to authenticated using (true);

create policy "Reservations: insert" on public.reservations
  for insert to authenticated with check (created_by = auth.uid());

create policy "Reservations: update owner or admin" on public.reservations
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

create policy "Reservations: delete owner or admin" on public.reservations
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- ── Groceries ──
drop policy if exists "Groceries: select"               on public.groceries;
drop policy if exists "Groceries: insert"               on public.groceries;
drop policy if exists "Groceries: update owner or admin" on public.groceries;
drop policy if exists "Groceries: delete owner or admin" on public.groceries;

create policy "Groceries: select" on public.groceries
  for select to authenticated using (true);

create policy "Groceries: insert" on public.groceries
  for insert to authenticated with check (created_by = auth.uid());

create policy "Groceries: update owner or admin" on public.groceries
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

create policy "Groceries: delete owner or admin" on public.groceries
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- ── Todos ──
drop policy if exists "Todos: select"               on public.todos;
drop policy if exists "Todos: insert"               on public.todos;
drop policy if exists "Todos: update owner or admin" on public.todos;
drop policy if exists "Todos: delete owner or admin" on public.todos;

create policy "Todos: select" on public.todos
  for select to authenticated using (true);

create policy "Todos: insert" on public.todos
  for insert to authenticated with check (created_by = auth.uid());

create policy "Todos: update owner or admin" on public.todos
  for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

create policy "Todos: delete owner or admin" on public.todos
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- ── Reservation Guests ──
drop policy if exists "Reservation guests: select"                on public.reservation_guests;
drop policy if exists "Reservation guests: insert editor or admin" on public.reservation_guests;
drop policy if exists "Reservation guests: insert own"            on public.reservation_guests;
drop policy if exists "Reservation guests: delete owner or admin" on public.reservation_guests;

create policy "Reservation guests: select" on public.reservation_guests
  for select to authenticated using (true);

-- Any authenticated user can add themselves as a guest (needed for invite join flow)
create policy "Reservation guests: insert own" on public.reservation_guests
  for insert to authenticated with check (created_by = auth.uid());

create policy "Reservation guests: delete owner or admin" on public.reservation_guests
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- ── Reservation Notes ──
drop policy if exists "Reservation notes: select"                on public.reservation_notes;
drop policy if exists "Reservation notes: insert editor or admin" on public.reservation_notes;
drop policy if exists "Reservation notes: delete owner or admin" on public.reservation_notes;

create policy "Reservation notes: select" on public.reservation_notes
  for select to authenticated using (true);

create policy "Reservation notes: insert editor or admin" on public.reservation_notes
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.reservations r
      where r.id = reservation_notes.reservation_id
        and (r.created_by = auth.uid() or public.is_admin())
    )
  );

create policy "Reservation notes: delete owner or admin" on public.reservation_notes
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- ── Invites ──
drop policy if exists "Invites: select"                          on public.invites;
drop policy if exists "Invites: insert reservation owner or admin" on public.invites;

create policy "Invites: select" on public.invites
  for select to authenticated using (true);

create policy "Invites: insert reservation owner or admin" on public.invites
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.reservations r
      where r.id = invites.reservation_id
        and (r.created_by = auth.uid() or public.is_admin())
    )
  );

-- ── Invite Responses ──
create policy "Invite responses: select" on public.invite_responses
  for select to authenticated using (true);

create policy "Invite responses: insert own" on public.invite_responses
  for insert to authenticated with check (user_id = auth.uid());

create policy "Invite responses: update own" on public.invite_responses
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Invite Dismissals (legacy) ──
drop policy if exists "Invite dismissals: select own" on public.invite_dismissals;
drop policy if exists "Invite dismissals: insert own" on public.invite_dismissals;

create policy "Invite dismissals: select own" on public.invite_dismissals
  for select to authenticated using (user_id = auth.uid());

create policy "Invite dismissals: insert own" on public.invite_dismissals
  for insert to authenticated with check (user_id = auth.uid());

-- ─── Schema Additions ────────────────────────────────────────

-- first_name column on profiles (supports separate first/last name signup)
alter table public.profiles add column if not exists first_name text;

-- occasion column on reservations (optional title/event label)
alter table public.reservations add column if not exists occasion text;

-- user_id column on reservation_guests (links a guest to a registered profile)
alter table public.reservation_guests add column if not exists user_id uuid references auth.users;

-- Join requests: any user can ask to join any reservation; the owner approves or denies
create table if not exists public.join_requests (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  requester_id   uuid not null references auth.users on delete cascade,
  rooms_needed   int not null default 1,
  message        text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at     timestamptz not null default now(),
  unique (reservation_id, requester_id)
);

alter table public.join_requests enable row level security;

drop policy if exists "Join requests: select"              on public.join_requests;
drop policy if exists "Join requests: insert own"          on public.join_requests;
drop policy if exists "Join requests: update owner or admin" on public.join_requests;

-- Requester can see their own; reservation owner and admin can see all for their reservation
create policy "Join requests: select" on public.join_requests
  for select to authenticated
  using (
    requester_id = auth.uid()
    or exists (
      select 1 from public.reservations r
      where r.id = join_requests.reservation_id
        and (r.created_by = auth.uid() or public.is_admin())
    )
  );

create policy "Join requests: insert own" on public.join_requests
  for insert to authenticated
  with check (requester_id = auth.uid());

create policy "Join requests: update owner or admin" on public.join_requests
  for update to authenticated
  using (
    exists (
      select 1 from public.reservations r
      where r.id = join_requests.reservation_id
        and (r.created_by = auth.uid() or public.is_admin())
    )
  );

-- ─── Seed Data ───────────────────────────────────────────────

-- Ensure settings row exists with 5 rooms (SunEscape has 5 bedrooms)
insert into public.settings (id, total_rooms)
values (1, 5)
on conflict (id) do update set total_rooms = 5;
