-- guest_cleanup.sql
--
-- Every visit to /guest that has no existing session creates a permanent
-- anonymous row in auth.users plus test attempts/responses. Left alone this
-- grows without bound. This schedules a nightly purge of anonymous accounts
-- older than 30 days.
--
-- Prerequisite: enable the pg_cron extension
-- (Dashboard > Database > Extensions > pg_cron).
--
-- Before running: check the FK behavior in your schema. If public.users.id
-- references auth.users(id) ON DELETE CASCADE, and test_attempts /
-- question_feedback cascade from public.users, the single DELETE below is
-- enough. If not, the explicit-order variant further down is the safe one.

-- Variant A — cascades in place:
select cron.schedule(
  'cleanup-anonymous-users',
  '0 3 * * *',  -- daily at 03:00 UTC
  $$
  delete from auth.users
  where is_anonymous
    and created_at < now() - interval '30 days'
  $$
);

-- Variant B — no cascades: delete dependents explicitly, children first.
-- (question_responses and attempt_questions cascade from test_attempts.)
--
-- select cron.schedule(
--   'cleanup-anonymous-users',
--   '0 3 * * *',
--   $$
--   with stale as (
--     select id from auth.users
--     where is_anonymous and created_at < now() - interval '30 days'
--   )
--   , _feedback as (
--     delete from public.question_feedback where user_id in (select id from stale)
--   )
--   , _attempts as (
--     delete from public.test_attempts where user_id in (select id from stale)
--   )
--   , _users as (
--     delete from public.users where id in (select id from stale)
--   )
--   delete from auth.users where id in (select id from stale)
--   $$
-- );

-- To inspect / remove the job later:
--   select * from cron.job;
--   select cron.unschedule('cleanup-anonymous-users');
