-- Nudge push sessions: one row per active notification-nudge session.
-- The send-nudges edge function (run by pg_cron every minute) sends a
-- web push for each row whose next_at has passed, then advances next_at.
-- Rows are deleted when the session ends (by the user or by ends_at).

create table if not exists nudge_push_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  subscription  jsonb not null,          -- web push subscription (endpoint + keys)
  interval_mins numeric not null check (interval_mins >= 1),
  cue           text not null,
  started_at    timestamptz not null default now(),
  ends_at       timestamptz,             -- null = until manually ended
  next_at       timestamptz not null
);

create index if not exists idx_nudge_push_next_at on nudge_push_sessions (next_at);

alter table nudge_push_sessions enable row level security;

create policy "own nudge sessions select" on nudge_push_sessions
  for select using (auth.uid() = user_id);
create policy "own nudge sessions insert" on nudge_push_sessions
  for insert with check (auth.uid() = user_id);
create policy "own nudge sessions delete" on nudge_push_sessions
  for delete using (auth.uid() = user_id);

-- ── Cron: call the send-nudges edge function every minute ──
-- Prereqs (Dashboard → Database → Extensions): enable pg_cron and pg_net.
-- Replace YOUR_PROJECT_REF and YOUR_CRON_SECRET below.
-- YOUR_CRON_SECRET must match the CRON_SECRET you set on the edge function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-nudges-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-nudges',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
