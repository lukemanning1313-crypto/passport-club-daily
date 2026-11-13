-- Group scores for Passport Club Daily. One row per player, per group, per day, per difficulty.
create table if not exists pcd_scores (
  day    int  not null,
  grp    text not null check (grp ~ '^[A-Z0-9]{3,12}$'),
  name   text not null check (char_length(name) between 1 and 16),
  mode   text not null check (mode in ('explorer','navigator')),
  score  int  not null check (score between 0 and 1000),
  stamps int  not null check (stamps between 0 and 5),
  detail jsonb,
  at     timestamptz not null default now(),
  primary key (day, grp, name, mode)
);
alter table pcd_scores enable row level security;
create policy "anyone can read a group's scores" on pcd_scores for select using (true);
create policy "anyone can post a score"          on pcd_scores for insert with check (true);
create policy "a score can be re-posted"         on pcd_scores for update using (true) with check (true);
