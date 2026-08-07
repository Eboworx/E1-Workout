-- Week schedule: Mon-first array of 7 labels shown in the week strip.
-- Labels matching a program day name link to that day; others (Run, Recover)
-- are quick-log activities.
alter table programs add column if not exists week_schedule jsonb;

update programs
set week_schedule = '["Lower 1","Push","Run","Lower 2","Pull","Run","Recover"]'::jsonb
where is_active = true;
