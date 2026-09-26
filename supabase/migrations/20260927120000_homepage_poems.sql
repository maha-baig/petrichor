-- Poems the owner chooses to show on the public homepage.
alter table public.pieces add column if not exists featured boolean not null default false;

-- The homepage is public, but pieces stay private: this hands out only the
-- title and text of pieces the owner has marked, and nothing else.
create or replace function public.hero_lines()
returns table (title text, body text)
language sql
stable
security definer
set search_path = public
as $$
  select p.title, p.body
  from public.pieces p
  join public.app_owner o on o.user_id = p.user_id
  where p.featured
  order by p.updated_at desc
  limit 40
$$;

revoke all on function public.hero_lines() from public;
grant execute on function public.hero_lines() to anon, authenticated;
