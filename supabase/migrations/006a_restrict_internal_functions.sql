-- ─────────────────────────────────────────────────────────────────────────────
-- 006a · Restrict internal functions
--
-- ⚠️  PARTIALLY SUPERSEDED BY 006b. Read both before acting on either.
--
-- The cleanup_expired_data() revoke below is correct and still stands. The two
-- RLS helper revokes were WRONG and broke every write for signed-in users; 006b
-- restores them and explains why. The comment in this file about policies being
-- "evaluated as the table owner" is the mistaken belief that caused it.
--
-- Recorded here verbatim as applied (version 20260909165138), because the repo
-- had drifted from the database and a migration nobody can read is a migration
-- somebody repeats.
-- ─────────────────────────────────────────────────────────────────────────────

-- cleanup_expired_data() is SECURITY DEFINER and DELETES rows. Migration 006
-- left it callable over PostgREST by anon and authenticated, which means anyone
-- holding the public anon key could trigger deletions. It is a maintenance job:
-- only the service role (and a scheduler running as it) has any business calling
-- it, and the service role bypasses these grants.
REVOKE ALL ON FUNCTION public.cleanup_expired_data() FROM PUBLIC, anon, authenticated;

-- These two exist solely to be referenced from RLS policy expressions. Policies
-- are evaluated as the table owner, so revoking the API grant does not affect
-- them, it only removes two pointless RPC endpoints.
REVOKE ALL ON FUNCTION public.auth_user_portfolio_ids() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auth_user_position_ids()  FROM PUBLIC, anon, authenticated;
