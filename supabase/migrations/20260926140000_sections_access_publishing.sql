-- ─────────────────────────────────────────────────────────────────────────────
--  Petrichor · poems, one owner, and approved readers
--
--  1. Poems live beside books: a work is a 'book' or a 'poems' collection.
--  2. Only the owner writes. Every insert, update and delete on her work is
--     refused for anyone else, whatever the app does.
--  3. Friends she approves can read what she has published — chapters and
--     poems with published_at set — and leave comments under a name they type.
--
--  Paste into the Supabase SQL editor and run once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. poems beside books ────────────────────────────────────────────────────

alter table public.works add column if not exists kind text not null default 'book';
alter table public.works drop constraint if exists works_kind_check;
alter table public.works add constraint works_kind_check check (kind in ('book', 'poems'));

alter table public.pieces add column if not exists published_at timestamptz;
create index if not exists pieces_published_idx on public.pieces (published_at) where published_at is not null;

-- ── 2. the owner ─────────────────────────────────────────────────────────────
-- Tied to an account id, not an email, so nobody can become the owner by
-- signing up with her address.

create table if not exists public.app_owner (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.app_owner enable row level security;
drop policy if exists "owner row is readable" on public.app_owner;
create policy "owner row is readable" on public.app_owner for select using (true);

insert into public.app_owner (user_id)
select id from auth.users where lower(email) = 'mahabaig7@gmail.com'
on conflict do nothing;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_owner where user_id = auth.uid());
$$;

-- ── 3. readers she approves ──────────────────────────────────────────────────

create table if not exists public.readers (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null default '',
  name         text not null default '',
  note         text not null default '',
  status       text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz
);
alter table public.readers enable row level security;

create or replace function public.is_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.readers where user_id = auth.uid() and status = 'approved');
$$;

drop policy if exists "readers see themselves, owner sees all" on public.readers;
create policy "readers see themselves, owner sees all" on public.readers
  for select using (user_id = auth.uid() or public.is_owner());

-- A friend may ask once, for themselves, and only ever as 'pending'.
drop policy if exists "friends can ask to read" on public.readers;
create policy "friends can ask to read" on public.readers
  for insert with check (user_id = auth.uid() and status = 'pending' and not public.is_owner());

drop policy if exists "owner decides" on public.readers;
create policy "owner decides" on public.readers
  for update using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner or the friend can remove" on public.readers;
create policy "owner or the friend can remove" on public.readers
  for delete using (public.is_owner() or user_id = auth.uid());

-- ── 4. books, chapters, poems: owner writes, approved readers read published ─

drop policy if exists "own works" on public.works;
drop policy if exists "works: owner reads" on public.works;
drop policy if exists "works: readers read published" on public.works;
drop policy if exists "works: owner writes" on public.works;
drop policy if exists "works: owner updates" on public.works;
drop policy if exists "works: owner deletes" on public.works;
create policy "works: owner reads" on public.works for select using (auth.uid() = user_id);
create policy "works: readers read published" on public.works for select using (
  public.is_reader()
  and exists (select 1 from public.pieces p where p.work_id = works.id and p.published_at is not null)
);
create policy "works: owner writes" on public.works for insert with check (auth.uid() = user_id and public.is_owner());
create policy "works: owner updates" on public.works for update
  using (auth.uid() = user_id and public.is_owner()) with check (auth.uid() = user_id and public.is_owner());
create policy "works: owner deletes" on public.works for delete using (auth.uid() = user_id and public.is_owner());

drop policy if exists "own pieces" on public.pieces;
drop policy if exists "pieces: owner reads" on public.pieces;
drop policy if exists "pieces: readers read published" on public.pieces;
drop policy if exists "pieces: owner writes" on public.pieces;
drop policy if exists "pieces: owner updates" on public.pieces;
drop policy if exists "pieces: owner deletes" on public.pieces;
create policy "pieces: owner reads" on public.pieces for select using (auth.uid() = user_id);
create policy "pieces: readers read published" on public.pieces for select using (public.is_reader() and published_at is not null);
create policy "pieces: owner writes" on public.pieces for insert with check (
  auth.uid() = user_id and public.is_owner()
  and exists (select 1 from public.works w where w.id = work_id and w.user_id = auth.uid())
);
create policy "pieces: owner updates" on public.pieces for update
  using (auth.uid() = user_id and public.is_owner())
  with check (
    auth.uid() = user_id and public.is_owner()
    and exists (select 1 from public.works w where w.id = work_id and w.user_id = auth.uid())
  );
create policy "pieces: owner deletes" on public.pieces for delete using (auth.uid() = user_id and public.is_owner());

-- History and the writing tally are hers alone.
drop policy if exists "own versions" on public.piece_versions;
create policy "own versions" on public.piece_versions for all
  using (auth.uid() = user_id and public.is_owner())
  with check (
    auth.uid() = user_id and public.is_owner()
    and exists (select 1 from public.pieces p where p.id = piece_id and p.user_id = auth.uid())
  );

drop policy if exists "own writing days" on public.writing_days;
create policy "own writing days" on public.writing_days for all
  using (auth.uid() = user_id and public.is_owner())
  with check (auth.uid() = user_id and public.is_owner());

-- ── 5. workspaces (inspiration) and images: hers alone ───────────────────────

drop policy if exists "own workspaces are readable" on public.workspaces;
drop policy if exists "own workspaces are insertable" on public.workspaces;
drop policy if exists "own workspaces are updatable" on public.workspaces;
drop policy if exists "own workspaces are deletable" on public.workspaces;
create policy "own workspaces are readable" on public.workspaces for select using (auth.uid() = user_id and public.is_owner());
create policy "own workspaces are insertable" on public.workspaces for insert with check (auth.uid() = user_id and public.is_owner());
create policy "own workspaces are updatable" on public.workspaces for update
  using (auth.uid() = user_id and public.is_owner()) with check (auth.uid() = user_id and public.is_owner());
create policy "own workspaces are deletable" on public.workspaces for delete using (auth.uid() = user_id and public.is_owner());

-- Storage: she writes; approved readers may see book covers (…/books/…) only.
drop policy if exists "own images are readable" on storage.objects;
drop policy if exists "own images are uploadable" on storage.objects;
drop policy if exists "own images are replaceable" on storage.objects;
drop policy if exists "own images are deletable" on storage.objects;
drop policy if exists "readers see covers" on storage.objects;
create policy "own images are readable" on storage.objects for select using (
  bucket_id = 'moodboards' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "readers see covers" on storage.objects for select using (
  bucket_id = 'moodboards' and public.is_reader() and (storage.foldername(name))[2] = 'books'
);
create policy "own images are uploadable" on storage.objects for insert with check (
  bucket_id = 'moodboards' and (storage.foldername(name))[1] = auth.uid()::text and public.is_owner()
);
create policy "own images are replaceable" on storage.objects for update using (
  bucket_id = 'moodboards' and (storage.foldername(name))[1] = auth.uid()::text and public.is_owner()
);
create policy "own images are deletable" on storage.objects for delete using (
  bucket_id = 'moodboards' and (storage.foldername(name))[1] = auth.uid()::text and public.is_owner()
);

-- ── 6. comments ──────────────────────────────────────────────────────────────
-- Under a name the friend types; tied to their account so only they (or the
-- owner) can remove it.

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  piece_id   uuid not null references public.pieces (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 60),
  body       text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists comments_piece_idx on public.comments (piece_id, created_at);
alter table public.comments enable row level security;

drop policy if exists "comments are readable" on public.comments;
create policy "comments are readable" on public.comments for select using (
  public.is_owner()
  or (public.is_reader() and exists (select 1 from public.pieces p where p.id = piece_id and p.published_at is not null))
);

drop policy if exists "readers comment on published work" on public.comments;
create policy "readers comment on published work" on public.comments for insert with check (
  user_id = auth.uid()
  and (public.is_owner() or public.is_reader())
  and exists (select 1 from public.pieces p where p.id = piece_id and p.published_at is not null)
);

drop policy if exists "owner marks seen" on public.comments;
create policy "owner marks seen" on public.comments for update using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner or author removes" on public.comments;
create policy "owner or author removes" on public.comments for delete using (public.is_owner() or user_id = auth.uid());
