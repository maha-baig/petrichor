-- ─────────────────────────────────────────────────────────────────────────────
--  Petrichor · replies to comments, and a credit line for cover pictures
--
--  1. A comment can answer another. Threads are one level deep: a reply to a
--     reply joins the same thread, under the comment that started it.
--  2. Her own comments are marked as hers, by the database, and never count
--     as new in her inbox.
--  3. A cover made from a found picture keeps its photographer and licence.
--
--  Paste into the Supabase SQL editor and run once. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. replies ───────────────────────────────────────────────────────────────

alter table public.comments add column if not exists parent_id uuid references public.comments (id) on delete cascade;
alter table public.comments add column if not exists by_owner boolean not null default false;
create index if not exists comments_parent_idx on public.comments (parent_id) where parent_id is not null;

-- What was already said by her.
update public.comments c set by_owner = true, seen_at = coalesce(c.seen_at, c.created_at)
where not c.by_owner and exists (select 1 from public.app_owner o where o.user_id = c.user_id);

-- Runs as whoever is commenting, so it can only see the comments they can.
create or replace function public.comment_threading()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  answered public.comments;
begin
  -- Decided here, not by the app: nobody can claim to be her, or hide a comment from her.
  new.by_owner := public.is_owner();
  new.seen_at := case when new.by_owner then now() else null end;

  if new.parent_id is null then
    return new;
  end if;

  select * into answered from public.comments where id = new.parent_id;
  if not found then
    raise exception 'The comment being answered is gone.';
  end if;
  if answered.piece_id <> new.piece_id then
    raise exception 'A reply belongs under the same piece as its comment.';
  end if;
  -- One level deep: answering a reply joins its thread.
  if answered.parent_id is not null then
    new.parent_id := answered.parent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_threading on public.comments;
create trigger comments_threading
  before insert on public.comments
  for each row execute function public.comment_threading();

-- ── 2. cover credit ──────────────────────────────────────────────────────────

alter table public.works add column if not exists cover_credit text not null default '';
