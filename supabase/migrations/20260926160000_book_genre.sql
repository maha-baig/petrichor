-- A genre for each book, to group the shelf into sections.
alter table public.works add column if not exists genre text not null default '';
