-- Migration 006: Performance Optimization for Production
-- Date: 2026-04-03
-- Purpose: Add missing indexes, optimize RLS policies with helper functions,
--          and introduce database-level analytics and cleanup functions
-- Author: InvestTracker Platform Team

-- ============================================================================
-- 1. MISSING PERFORMANCE INDEXES
-- ============================================================================

-- Current prices cache lookup optimization
-- Composite index for efficient cache validity checks during price lookups
CREATE INDEX IF NOT EXISTS idx_current_prices_symbol_expires
  ON current_prices(symbol, expires_at)
  WHERE is_active = true;

-- Price history optimization for recent data queries
-- Used when fetching recent price movements and charts
CREATE INDEX IF NOT EXISTS idx_price_history_symbol_date
  ON price_history(symbol, date DESC)
  WHERE is_active = true;

-- Transaction list retrieval optimization
-- Composite index for efficient pagination of transaction history
CREATE INDEX IF NOT EXISTS idx_transactions_position_executed
  ON transactions(position_id, executed_at DESC);

-- Watchlist access optimization
-- Critical missing index for user's watchlist retrieval
-- watchlists has no deleted_at column, so there is no partial predicate here.
CREATE INDEX IF NOT EXISTS idx_watchlists_user_id
  ON watchlists(user_id);

-- Failed fetch tracking optimization
-- Partial index for unresolved fetch failures (more common case)
CREATE INDEX IF NOT EXISTS idx_failed_fetches_unresolved
  ON failed_fetches(symbol, last_attempt DESC)
  WHERE resolved = false;

-- Leaderboard and portfolio snapshot optimization
-- Multi-column index for efficient ranking queries by performance metrics
-- portfolio_snapshots has no deleted_at column either.
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_ranking
  ON portfolio_snapshots(portfolio_id, snapshot_date DESC, total_return_pct DESC);

-- ============================================================================
-- 2. OPTIMIZED RLS HELPER FUNCTIONS
-- ============================================================================
-- These functions replace subquery-based RLS checks for better performance
-- They use SECURITY DEFINER to run with elevated privileges and avoid
-- repeated authentication checks in complex RLS policies

-- Helper function: Get all portfolio IDs owned by current user
-- Used in RLS policies for positions, transactions, and other entities
CREATE OR REPLACE FUNCTION auth_user_portfolio_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM portfolios
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL;
$$;

-- Helper function: Get all position IDs accessible to current user
-- Optimized alternative to double-join subqueries in transaction RLS
CREATE OR REPLACE FUNCTION auth_user_position_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pos.id FROM positions pos
  WHERE pos.portfolio_id IN (
    SELECT id FROM portfolios
    WHERE user_id = auth.uid()
      AND deleted_at IS NULL
  );
$$;

-- ============================================================================
-- 3. OPTIMIZED RLS POLICIES
-- ============================================================================
-- Replace slow subquery-based policies with faster helper function queries

-- POSITIONS TABLE: Drop old policies and create optimized versions
DROP POLICY IF EXISTS positions_insert ON positions;
DROP POLICY IF EXISTS positions_update ON positions;
DROP POLICY IF EXISTS positions_delete ON positions;

CREATE POLICY positions_insert ON positions
  FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT auth_user_portfolio_ids()));

CREATE POLICY positions_update ON positions
  FOR UPDATE
  USING (portfolio_id IN (SELECT auth_user_portfolio_ids()))
  WITH CHECK (portfolio_id IN (SELECT auth_user_portfolio_ids()));

CREATE POLICY positions_delete ON positions
  FOR DELETE
  USING (portfolio_id IN (SELECT auth_user_portfolio_ids()));

-- TRANSACTIONS TABLE: Drop old policies and create optimized versions
DROP POLICY IF EXISTS transactions_insert ON transactions;
DROP POLICY IF EXISTS transactions_delete ON transactions;

CREATE POLICY transactions_insert ON transactions
  FOR INSERT
  WITH CHECK (position_id IN (SELECT auth_user_position_ids()));

CREATE POLICY transactions_delete ON transactions
  FOR DELETE
  USING (position_id IN (SELECT auth_user_position_ids()));

-- Note: SELECT policies remain unchanged as they were optimized in migration 005
-- for handling public/shared visibility checks

-- ============================================================================
-- 4. DATABASE-LEVEL PORTFOLIO ANALYTICS FUNCTION
-- ============================================================================
-- Moves asset allocation computation from API layer to database
-- Improves performance by reducing data transfer and enabling better caching
-- Returns JSON with allocation breakdowns by asset type and by symbol

CREATE OR REPLACE FUNCTION get_portfolio_allocation(portfolio_uuid UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  -- Verify ownership or public visibility before returning data
  IF NOT EXISTS (
    SELECT 1 FROM portfolios
    WHERE id = portfolio_uuid
      AND (user_id = auth.uid() OR visibility = 'public')
      AND deleted_at IS NULL
  ) THEN
    -- Return NULL for unauthorized access (RLS will also prevent this)
    RETURN NULL;
  END IF;

  -- Compute allocation metrics with CTE approach for clarity and performance
  WITH pos_values AS (
    -- Get all active positions with computed market value
    SELECT symbol, asset_type, quantity, avg_cost,
           quantity * avg_cost AS value
    FROM positions
    WHERE portfolio_id = portfolio_uuid
      AND quantity > 0
      AND deleted_at IS NULL
  ),
  totals AS (
    -- Calculate total portfolio value for percentage calculations
    SELECT COALESCE(SUM(value), 0) AS total FROM pos_values
  )
  SELECT json_build_object(
    'byType', (
      -- Allocation by asset type (stocks, crypto, bonds, etc.)
      SELECT COALESCE(json_agg(json_build_object(
        'name', asset_type,
        'value', ROUND(type_value::numeric, 2),
        'pct', CASE
          WHEN t.total > 0 THEN ROUND((type_value / t.total * 100)::numeric, 2)
          ELSE 0
        END
      ) ORDER BY type_value DESC), '[]'::json)
      FROM (
        SELECT asset_type, SUM(value) AS type_value
        FROM pos_values
        GROUP BY asset_type
      ) type_breakdown, totals t
    ),
    'bySymbol', (
      -- Allocation by individual symbol (top holdings)
      SELECT COALESCE(json_agg(json_build_object(
        'symbol', symbol,
        'assetType', asset_type,
        'value', ROUND(value::numeric, 2),
        'pct', CASE
          WHEN t.total > 0 THEN ROUND((value / t.total * 100)::numeric, 2)
          ELSE 0
        END
      ) ORDER BY value DESC), '[]'::json)
      FROM pos_values, totals t
    ),
    'total', (SELECT ROUND(total::numeric, 2) FROM totals)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================================
-- 5. PORTFOLIO PERFORMANCE METRICS FUNCTION
-- ============================================================================
-- Calculate key performance indicators for a portfolio
-- Used for leaderboard rankings and portfolio comparison

CREATE OR REPLACE FUNCTION get_portfolio_performance(portfolio_uuid UUID)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  -- Verify access permissions
  IF NOT EXISTS (
    SELECT 1 FROM portfolios
    WHERE id = portfolio_uuid
      AND (user_id = auth.uid() OR visibility = 'public')
      AND deleted_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  -- Get latest performance snapshot with fallback calculations
  WITH latest_snapshot AS (
    SELECT total_value, total_return_pct, dividend_income,
           snapshot_date
    FROM portfolio_snapshots
    WHERE portfolio_id = portfolio_uuid
    ORDER BY snapshot_date DESC
    LIMIT 1
  ),
  earliest_snapshot AS (
    SELECT total_value, snapshot_date
    FROM portfolio_snapshots
    WHERE portfolio_id = portfolio_uuid
    ORDER BY snapshot_date ASC
    LIMIT 1
  )
  SELECT json_build_object(
    'currentValue', COALESCE((SELECT total_value FROM latest_snapshot), 0),
    'totalReturn', COALESCE((SELECT total_return_pct FROM latest_snapshot), 0),
    'returnPct', CASE
      WHEN (SELECT total_value FROM earliest_snapshot) > 0
      THEN ROUND(
        ((COALESCE((SELECT total_value FROM latest_snapshot), 0) -
          (SELECT total_value FROM earliest_snapshot)) /
         (SELECT total_value FROM earliest_snapshot) * 100)::numeric,
        2
      )
      ELSE 0
    END,
    'dividendIncome', COALESCE((SELECT dividend_income FROM latest_snapshot), 0),
    'lastUpdated', (SELECT snapshot_date FROM latest_snapshot)
  ) INTO result;

  RETURN result;
END;
$$;

-- ============================================================================
-- 6. AUTOMATIC DATA CLEANUP FUNCTION
-- ============================================================================
-- Removes expired and obsolete data to maintain database performance
-- Should be scheduled to run periodically (daily recommended)
-- Can be triggered via pg_cron extension or external scheduler

CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS TABLE(
  expired_prices BIGINT,
  resolved_fetches BIGINT,
  expired_cache BIGINT,
  expired_events BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_prices BIGINT;
  v_resolved_fetches BIGINT;
  v_expired_cache BIGINT;
  v_expired_events BIGINT;
BEGIN
  -- Delete expired current price cache entries (older than 1 hour)
  DELETE FROM current_prices
  WHERE expires_at < now() - interval '1 hour'
    AND is_active = false;
  GET DIAGNOSTICS v_expired_prices = ROW_COUNT;

  -- Delete resolved fetch failures older than 7 days (keep for audit trail)
  DELETE FROM failed_fetches
  WHERE resolved = true
    AND last_attempt < now() - interval '7 days';
  GET DIAGNOSTICS v_resolved_fetches = ROW_COUNT;

  -- Delete expired leaderboard cache entries
  DELETE FROM leaderboard_cache
  WHERE expires_at < now();
  GET DIAGNOSTICS v_expired_cache = ROW_COUNT;

  -- Delete expired market events (older than 1 day). market_events has no
  -- archived column, so expiry alone decides.
  DELETE FROM market_events
  WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_expired_events = ROW_COUNT;

  -- Return cleanup statistics for monitoring
  RETURN QUERY SELECT v_expired_prices, v_resolved_fetches, v_expired_cache, v_expired_events;
END;
$$;

-- ============================================================================
-- 7. STATISTICS AND TABLE ANALYSIS
-- ============================================================================
-- IMPORTANT: Run ANALYZE periodically (daily or after bulk operations)
-- to keep query planner statistics up to date and maintain performance
--
-- For production setup, add a scheduled job (via pg_cron or external scheduler):
--
-- SELECT cron.schedule('analyze_investtracker_db', '0 2 * * *', 
--   'ANALYZE portfolios; ANALYZE positions; ANALYZE transactions; 
--    ANALYZE watchlists; ANALYZE price_history; ANALYZE portfolio_snapshots;');
--
-- Manual statistics refresh:
ANALYZE portfolios;
ANALYZE positions;
ANALYZE transactions;
ANALYZE watchlist_items;
ANALYZE watchlists;
ANALYZE current_prices;
ANALYZE price_history;
ANALYZE portfolio_snapshots;
ANALYZE market_events;
ANALYZE company_data;
ANALYZE failed_fetches;
ANALYZE leaderboard_cache;
ANALYZE activity_feed;

-- ============================================================================
-- MIGRATION SUMMARY
-- ============================================================================
-- This migration adds:
--
-- 1. Six missing but critical indexes for frequently queried tables
--    - Reduces query times from full table scans to index lookups
--    - Composite indexes optimize multi-column WHERE and ORDER BY clauses
--
-- 2. Two helper functions for RLS policy optimization
--    - Replaces subquery-based RLS with SECURITY DEFINER functions
--    - Reduces execution time of INSERT/UPDATE/DELETE operations
--    - Prevents repeated auth checks in complex permission logic
--
-- 3. Optimized RLS policies for positions and transactions tables
--    - Now use helper functions instead of inline subqueries
--    - Significant performance improvement for write operations
--
-- 4. Database-level portfolio analytics function
--    - Moves allocation computation from API to database
--    - Enables caching at database level
--    - Reduces API response times and data transfer
--
-- 5. Portfolio performance metrics function
--    - Calculates returns, dividends, and performance indicators
--    - Optimized for leaderboard and comparison queries
--
-- 6. Automatic cleanup function for expired data
--    - Keeps database lean and performant
--    - Should be scheduled to run daily
--    - Removes stale cache entries and old fetch failure records
--
-- Next steps for production deployment:
-- - Monitor slow query log after deployment
-- - Verify RLS policies still enforce security correctly
-- - Set up pg_cron or external scheduler for cleanup function
-- - Consider index maintenance schedule (REINDEX if needed)
-- - Run ANALYZE after any bulk data operations
