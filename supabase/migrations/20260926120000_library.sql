-- ─────────────────────────────────────────────────────────────────────────────
--  Petrichor · Books
--
--  A book has a cover, a description, and a table of contents made of parts,
--  chapters and sections. Each chapter or section is written in the editor;
--  its history is kept, and the words written each day are tallied.
--
--  Paste into the Supabase SQL editor and run once. Safe to re-run.
--  Depends on touch_updated_at() and the `moodboards` bucket from the
--  workspaces migration (covers live there, under <user_id>/books/…).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── books ────────────────────────────────────────────────────────────────────

create table if not exists public.works (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,

  title        text not null default '',
  subtitle     text not null default '',
  author       text not null default '',
  description  text not null default '',
  dedication   text not null default '',
  epigraph     text not null default '',
  -- the cover: an uploaded image, or a typeset cover in this colour
  cover_path   text,
  cover_color  text not null default '#2a1f2d',
  -- total words the book is aiming for; 0 = no target
  goal_words   integer not null default 0 check (goal_words >= 0),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- (if an earlier draft of this file created the table, bring it up to date)
alter table public.works add column if not exists description text not null default '';
alter table public.works add column if not exists cover_path  text;
alter table public.works add column if not exists cover_color text not null default '#2a1f2d';

create index if not exists works_user_updated_idx on public.works (user_id, updated_at desc);

drop trigger if exists works_touch_updated_at on public.works;
create trigger works_touch_updated_at
  before update on public.works
  for each row execute function public.touch_updated_at();

-- ── the table of contents ────────────────────────────────────────────────────
-- One flat, ordered list. A part opens a group of chapters; a section belongs
-- to the chapter above it. `position` is the reading order.

create table if not exists public.pieces (
  id          uuid primary key default gen_random_uuid(),
  work_id     uuid not null references public.works (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,

  kind        text not null default 'chapter' check (kind in ('part', 'chapter', 'section')),
  title       text not null default '',
  -- the writing, as HTML from the editor
  body        text not null default '',
  words       integer not null default 0,
  status      text not null default 'draft' check (status in ('draft', 'revising', 'final')),
  position    integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.pieces add column if not exists kind  text not null default 'chapter';
alter table public.pieces add column if not exists words integer not null default 0;
alter table public.pieces drop column if exists section;

create index if not exists pieces_work_idx on public.pieces (work_id, position);

drop trigger if exists pieces_touch_updated_at on public.pieces;
create trigger pieces_touch_updated_at
  before update on public.pieces
  for each row execute function public.touch_updated_at();

-- ── versions: snapshots of a chapter, to look back on and restore ────────────

create table if not exists public.piece_versions (
  id          uuid primary key default gen_random_uuid(),
  piece_id    uuid not null references public.pieces (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,

  title       text not null default '',
  body        text not null default '',
  word_count  integer not null default 0,
  -- 'auto' while writing, 'kept' when asked for, 'restore' just before a restore
  reason      text not null default 'auto' check (reason in ('auto', 'kept', 'restore')),

  created_at  timestamptz not null default now()
);

create index if not exists piece_versions_piece_idx on public.piece_versions (piece_id, created_at desc);

-- ── writing days: words added per calendar day, for goals and streaks ────────

create table if not exists public.writing_days (
  user_id  uuid not null references auth.users (id) on delete cascade,
  day      date not null,
  words    integer not null default 0 check (words >= 0),
  primary key (user_id, day)
);

-- Add to today's tally in one statement, so two tabs can't overwrite each other.
create or replace function public.add_words_written(p_day date, p_words integer)
returns void
language sql
security invoker
as $$
  insert into public.writing_days (user_id, day, words)
  values (auth.uid(), p_day, greatest(p_words, 0))
  on conflict (user_id, day)
  do update set words = public.writing_days.words + greatest(excluded.words, 0);
$$;

-- ── row-level security: your own rows only ───────────────────────────────────

alter table public.works          enable row level security;
alter table public.pieces         enable row level security;
alter table public.piece_versions enable row level security;
alter table public.writing_days   enable row level security;

drop policy if exists "own works" on public.works;
create policy "own works"
  on public.works for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A piece must be yours AND sit inside a book that is yours.
drop policy if exists "own pieces" on public.pieces;
create policy "own pieces"
  on public.pieces for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.works w where w.id = work_id and w.user_id = auth.uid())
  );

drop policy if exists "own versions" on public.piece_versions;
create policy "own versions"
  on public.piece_versions for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.pieces p where p.id = piece_id and p.user_id = auth.uid())
  );

drop policy if exists "own writing days" on public.writing_days;
create policy "own writing days"
  on public.writing_days for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
