-- ─────────────────────────────────────────────────────────────────────────────
-- NOT APPLIED — SUPERSEDED. Do not run this without reading the note below.
--
-- This schedules a pg_cron job that fires every minute against the update-prices
-- Edge Function. Two reasons it is not part of the deployed schema:
--
--   1. It builds the URL from current_setting('app.supabase_url'), a custom GUC
--      that is not set on this project. current_setting() throws on an unset
--      setting, so every one of the 1440 daily runs would error.
--
--   2. Scheduling moved to Vercel Cron. See the "crons" block in vercel.json,
--      which drives /api/cron/snapshots and /api/cron/baselines. Enabling this
--      as well would mean two schedulers refreshing the same prices.
--
-- Kept in the repo as the record of the original approach.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable required extensions for scheduled jobs and HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create a cron job that runs every 60 seconds during market hours
-- Market hours: Mon-Fri, 9:30-16:00 ET = 14:30-21:00 UTC
-- Cron expression: * * * * * (every minute)
-- We'll filter the actual execution to market hours in the Edge Function
SELECT cron.schedule(
  'update-prices-every-minute',
  '* * * * *', -- every minute
  $$
  SELECT
    net.http_post(
      'https://' || current_setting('app.supabase_url') || '/functions/v1/update-prices',
      jsonb_build_object('timestamp', NOW()),
      'application/json',
      5000
    ) as request_id;
  $$
);

-- Alternative: if running every minute is too frequent, use this for every 60 seconds
-- (Note: pg_cron doesn't support sub-minute intervals, but you can run this every minute
-- and have the Edge Function debounce or use a separate timestamp check)
