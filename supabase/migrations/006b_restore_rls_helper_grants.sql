-- ─────────────────────────────────────────────────────────────────────────────
-- 006b · Restore the RLS helper grants 006a took away
--
-- Recorded here verbatim as applied (version 20260909165238). The repo had
-- drifted from the database; this file exists so the lesson in it is readable
-- from the codebase rather than only from the migration table.
--
-- The lesson, stated plainly for whoever reads a linter warning about these two
-- functions next: they are SUPPOSED to be executable by anon and authenticated.
-- Revoking them is not hardening, it is an outage.
-- ─────────────────────────────────────────────────────────────────────────────

-- Corrects 006a. RLS policy expressions are evaluated with the privileges of the
-- querying role, not the table owner, so a role that cannot EXECUTE a function
-- named in a policy is denied the whole operation. Revoking these two broke
-- every INSERT/UPDATE/DELETE on positions and transactions for signed-in users.
--
-- They are safe to expose: both read only the caller's own rows via auth.uid(),
-- so an anon caller gets an empty set.
GRANT EXECUTE ON FUNCTION public.auth_user_portfolio_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_position_ids()  TO anon, authenticated;

-- cleanup_expired_data() stays revoked: it DELETES, it is referenced by no
-- policy, and only the service role should ever run it.
