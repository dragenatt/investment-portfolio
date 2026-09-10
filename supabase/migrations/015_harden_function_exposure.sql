-- ─────────────────────────────────────────────────────────────────────────────
-- 015 · Take the functions that do not belong on the public API off it,
--       and stop pg_trgm living in the public schema.
--
-- PostgREST exposes every function in `public` at /rest/v1/rpc/<name>, and the
-- anon key ships inside the browser bundle. "Callable by anon" therefore means
-- "callable by any visitor", which is the frame for everything below.
--
-- ── What is deliberately NOT touched ────────────────────────────────────────
--
-- auth_user_portfolio_ids, auth_user_position_ids, user_owns_portfolio and
-- user_has_portfolio_share stay exactly as they are. All four are named inside
-- RLS policy expressions — 9 policies across positions, transactions, portfolios
-- and portfolio_shares — and policy expressions are evaluated with the
-- privileges of the QUERYING role, not the table owner. A role that cannot
-- EXECUTE a function named in a policy is denied the operation outright.
--
-- That is not theory: 006a revoked two of them and broke every write for
-- signed-in users; 006b had to restore them. Read both files before touching
-- these again. All four filter on auth.uid(), so an anon caller reads an empty
-- set and there is nothing to harden.
--
-- get_portfolio_allocation and get_portfolio_performance also stay. Both guard
-- internally with `user_id = auth.uid() OR visibility = 'public'`, and anonymous
-- access to a portfolio its owner marked public is the feature working.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A trigger function is not an endpoint ───────────────────────────────────
-- handle_new_user fires from a trigger on auth.users. Postgres checks EXECUTE at
-- CREATE TRIGGER time, not at fire time, so signup does not depend on these
-- grants at all.
--
-- The `authenticated` grant is left in place on purpose. Calling a trigger
-- function directly fails on the undefined NEW record, so it is harmless, and
-- signup is not a path worth taking any risk on to clear a linter row. The anon
-- grant is the one that mattered and it is gone.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;

-- ── Action functions: signed-in callers only ────────────────────────────────
-- Each already guards on auth.uid() internally, so an anonymous call could not
-- reach anyone else's data. But toggle_follow and toggle_portfolio_like INSERT
-- rows, and a visitor with no session has no business reaching a write endpoint
-- at all — the guard should not be the only thing standing there.
--
-- Verified safe against the callers first: all five API routes that invoke these
-- use the user's session client and return 401 before the RPC when there is no
-- user, so nothing in the app ever calls them as anon.
REVOKE ALL ON FUNCTION public.soft_delete_portfolio(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_portfolio(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_portfolio(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_follow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_follow(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_follow(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_portfolio_like(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_portfolio_like(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.toggle_portfolio_like(uuid) TO authenticated;

-- ── Pin the search_path on the two trigger helpers ──────────────────────────
-- Both bodies are a single assignment of now() to NEW.updated_at and reference
-- no schema-qualified object, so an empty search_path is safe and removes any
-- chance of a name resolving out of a caller-controlled path.
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.update_updated_at() SET search_path = '';

-- ── pg_trgm out of public ───────────────────────────────────────────────────
-- The two GIN indexes on profiles reference gin_trgm_ops by OID, so they survive
-- the move untouched — verified: both still report indisvalid afterwards.
--
-- search_users() is the one thing that calls similarity() explicitly. It is
-- SECURITY INVOKER with search_path=public, so moving the extension without
-- updating it would break user search silently. Both happen here, in one
-- transaction, and the result was checked against a baseline taken beforehand:
-- 'diego' 2 rows, 'brian' 1, 'juan' 1, 'gerardo' 1 — identical before and after.
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER FUNCTION public.search_users(text, integer) SET search_path = public, extensions;
