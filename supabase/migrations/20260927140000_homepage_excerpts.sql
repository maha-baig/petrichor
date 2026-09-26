-- Lines picked out of a book's chapter for the public homepage.
create table if not exists public.hero_excerpts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  piece_id   uuid not null references public.pieces (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);
alter table public.hero_excerpts enable row level security;
drop policy if exists "owner manages excerpts" on public.hero_excerpts;
create policy "owner manages excerpts" on public.hero_excerpts
  for all using (public.is_owner()) with check (public.is_owner());

-- Homepage lines: whole poems marked for it (html), and picked lines (plain text).
drop function if exists public.hero_lines();
create function public.hero_lines()
returns table (title text, body text, plain boolean)
language sql
stable
security definer
set search_path = public
as $$
  (select p.title, p.body, false
     from public.pieces p
     join public.app_owner o on o.user_id = p.user_id
    where p.featured
    order by p.updated_at desc
    limit 40)
  union all
  (select coalesce(nullif(w.title, ''), nullif(p.title, ''), ''), e.body, true
     from public.hero_excerpts e
     join public.app_owner o on o.user_id = e.user_id
     join public.pieces p on p.id = e.piece_id
     join public.works w on w.id = p.work_id
    order by e.created_at desc
    limit 60)
$$;
revoke all on function public.hero_lines() from public;
grant execute on function public.hero_lines() to anon, authenticated;
