-- ─────────────────────────────────────────────────────────────────────────────
-- 014b · soft_delete_portfolio, written down
--
-- DELETE /api/portfolio/[id] calls this function, 015 revokes and grants on it,
-- 020 relies on it — and no migration in this repository ever created it. It
-- exists in production because it was made there by hand. A database rebuilt
-- from these files would stop at 015 ("function does not exist"), and the one
-- way to delete a portfolio would be missing even if it got past that.
--
-- The body below is pg_get_functiondef() of the production function, read on
-- 2026-09-21, unchanged. Applying it to production replaces the function with
-- itself; its grants survive CREATE OR REPLACE.
--
-- Why a SECURITY DEFINER function and not a plain UPDATE from the route:
-- portfolios_select only shows rows with deleted_at IS NULL, so the owner's own
-- UPDATE ... SET deleted_at = now() produces a row their policy can no longer
-- see, and Postgres refuses it. The function sets the column as its owner, and
-- keeps the ownership check itself: user_id = auth.uid().
--
-- Named 014b so that it sorts before 015, the first migration that refers to
-- it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.soft_delete_portfolio(p_portfolio_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE portfolios
  SET deleted_at = now(), updated_at = now()
  WHERE id = p_portfolio_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portfolio not found or not owned by user';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.soft_delete_portfolio(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_portfolio(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_portfolio(uuid) TO authenticated;
