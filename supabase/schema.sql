-- ─────────────────────────────────────────────────────────────────────────────
--  Petrichor · Supabase schema
--
--  Paste this whole file into the Supabase SQL editor and run it once.
--  It is safe to re-run: everything is idempotent.
--
--  What it creates:
--    · a `workspaces` table, one row per chosen prompt
--    · row-level security so a poet can only ever see their own rows
--    · a private `moodboards` storage bucket, with the same ownership rule
--    · a trigger that keeps updated_at honest
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── the table ────────────────────────────────────────────────────────────────

create table if not exists public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  title         text        not null default '',
  prompt        jsonb       not null default '{"text":"","seed_image":""}'::jsonb,
  mood          text        not null default 'melancholy',

  -- { evocative: [], searchTerms: [], palette: [{name,hex}] }
  words         jsonb,
  -- [{ id, path, aspect }] — `path` points into the moodboards bucket
  images        jsonb       not null default '[]'::jsonb,
  -- hexes pulled out of those images
  board_palette jsonb       not null default '[]'::jsonb,
  -- what the vision model saw: { see, prompt, colors }
  reading       jsonb,
  -- { path, prompt } for the generated illustration
  generated     jsonb,
  poem          text        not null default '',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- the list view is always "mine, newest touched first"
create index if not exists workspaces_user_updated_idx
  on public.workspaces (user_id, updated_at desc);

-- ── updated_at, kept honest server-side ──────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspaces_touch_updated_at on public.workspaces;
create trigger workspaces_touch_updated_at
  before update on public.workspaces
  for each row execute function public.touch_updated_at();

-- ── row-level security ───────────────────────────────────────────────────────
-- Without this, the anon key would read every poet's work. With it, the
-- database itself refuses — the client cannot ask for someone else's rows.

alter table public.workspaces enable row level security;

drop policy if exists "own workspaces are readable" on public.workspaces;
create policy "own workspaces are readable"
  on public.workspaces for select
  using (auth.uid() = user_id);

drop policy if exists "own workspaces are insertable" on public.workspaces;
create policy "own workspaces are insertable"
  on public.workspaces for insert
  with check (auth.uid() = user_id);

drop policy if exists "own workspaces are updatable" on public.workspaces;
create policy "own workspaces are updatable"
  on public.workspaces for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own workspaces are deletable" on public.workspaces;
create policy "own workspaces are deletable"
  on public.workspaces for delete
  using (auth.uid() = user_id);

-- ── storage: the mood-board images ───────────────────────────────────────────
-- Private bucket. Files live at  <user_id>/<workspace_id>/<file>, and the
-- policies below make that first path segment the ownership check.

insert into storage.buckets (id, name, public)
values ('moodboards', 'moodboards', false)
on conflict (id) do nothing;

drop policy if exists "own images are readable" on storage.objects;
create policy "own images are readable"
  on storage.objects for select
  using (
    bucket_id = 'moodboards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own images are uploadable" on storage.objects;
create policy "own images are uploadable"
  on storage.objects for insert
  with check (
    bucket_id = 'moodboards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own images are replaceable" on storage.objects;
create policy "own images are replaceable"
  on storage.objects for update
  using (
    bucket_id = 'moodboards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own images are deletable" on storage.objects;
create policy "own images are deletable"
  on storage.objects for delete
  using (
    bucket_id = 'moodboards'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
