-- ============================================================
-- MIGRACIÓN 005: Fundación Social para Comparativa de Portafolios
-- InvestTracker - 2 de Abril 2026
-- ============================================================
-- Nuevas tablas: follows, portfolio_likes, portfolio_snapshots,
--   portfolio_shares, saved_comparisons, leaderboard_cache, activity_feed
-- Tablas modificadas: profiles, portfolios
-- Nuevas funciones: toggle_follow, toggle_portfolio_like,
--   generate_username, search_users, get_public_portfolios
-- ============================================================

-- ============================================================
-- 1. EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 2. EXPANDIR TABLA PROFILES
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS location TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS website TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portfolio_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Índices para búsqueda fuzzy de usuarios
CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm
  ON profiles USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_display_name_trgm
  ON profiles USING gin (display_name gin_trgm_ops);

-- ============================================================
-- 3. EXPANDIR TABLA PORTFOLIOS CON VISIBILIDAD
-- ============================================================
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  ADD COLUMN IF NOT EXISTS show_amounts BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_positions BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_transactions BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_allocation BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Constraint para visibilidad
ALTER TABLE portfolios
  DROP CONSTRAINT IF EXISTS portfolios_visibility_check;
ALTER TABLE portfolios
  ADD CONSTRAINT portfolios_visibility_check
  CHECK (visibility IN ('public', 'private', 'shared'));

-- Índices para discovery y performance
CREATE INDEX IF NOT EXISTS idx_portfolios_visibility
  ON portfolios (visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portfolios_user_id
  ON portfolios (user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_share_token
  ON portfolios (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portfolios_tags
  ON portfolios USING gin (tags);

-- Índices faltantes en tablas existentes
CREATE INDEX IF NOT EXISTS idx_portfolios_user_deleted
  ON portfolios (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_positions_symbol
  ON positions (symbol);
CREATE INDEX IF NOT EXISTS idx_transactions_executed
  ON transactions (executed_at DESC);

-- ============================================================
-- 4. TABLA: follows
-- ============================================================
CREATE TABLE IF NOT EXISTS follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_following
  ON follows (following_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower
  ON follows (follower_id);

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY follows_select ON follows
  FOR SELECT TO authenticated USING (true);
CREATE POLICY follows_insert ON follows
  FOR INSERT TO authenticated WITH CHECK (follower_id = auth.uid());
CREATE POLICY follows_delete ON follows
  FOR DELETE TO authenticated USING (follower_id = auth.uid());

-- ============================================================
-- 5. TABLA: portfolio_likes
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_likes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, portfolio_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_likes_portfolio
  ON portfolio_likes (portfolio_id);

ALTER TABLE portfolio_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY likes_select ON portfolio_likes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY likes_insert ON portfolio_likes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY likes_delete ON portfolio_likes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- 6. TABLA: portfolio_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_value NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  total_return NUMERIC NOT NULL DEFAULT 0,
  total_return_pct NUMERIC NOT NULL DEFAULT 0,
  position_count INTEGER NOT NULL DEFAULT 0,
  allocation JSONB DEFAULT '{}',
  top_holdings JSONB DEFAULT '[]',
  risk_score NUMERIC,
  sharpe_ratio NUMERIC,
  volatility NUMERIC,
  max_drawdown NUMERIC,
  beta NUMERIC,
  alpha NUMERIC,
  sortino_ratio NUMERIC,
  win_rate NUMERIC,
  diversification_score NUMERIC,
  currency TEXT NOT NULL DEFAULT 'MXN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_portfolio_date
  ON portfolio_snapshots (portfolio_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_date
  ON portfolio_snapshots (snapshot_date);

ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Lectura: dueño + portafolios públicos + compartidos
CREATE POLICY snapshots_select ON portfolio_snapshots
  FOR SELECT TO authenticated
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
    OR portfolio_id IN (
      SELECT id FROM portfolios
      WHERE visibility = 'public' AND deleted_at IS NULL
    )
    OR portfolio_id IN (
      SELECT p.id FROM portfolios p
      JOIN portfolio_shares ps ON ps.portfolio_id = p.id
      WHERE ps.shared_with_user_id = auth.uid() AND p.deleted_at IS NULL
    )
  );

-- Service role puede escribir (cron jobs)
CREATE POLICY snapshots_service ON portfolio_snapshots
  FOR ALL TO service_role USING (true);

-- ============================================================
-- 7. TABLA: portfolio_shares
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_via TEXT NOT NULL DEFAULT 'link'
    CHECK (shared_via IN ('link', 'user', 'email')),
  permission TEXT NOT NULL DEFAULT 'view'
    CHECK (permission IN ('view', 'compare')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shares_portfolio
  ON portfolio_shares (portfolio_id);
CREATE INDEX IF NOT EXISTS idx_shares_user
  ON portfolio_shares (shared_with_user_id);

ALTER TABLE portfolio_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY shares_select ON portfolio_shares
  FOR SELECT TO authenticated
  USING (
    shared_with_user_id = auth.uid()
    OR portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );
CREATE POLICY shares_insert ON portfolio_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );
CREATE POLICY shares_delete ON portfolio_shares
  FOR DELETE TO authenticated
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

-- ============================================================
-- 8. TABLA: saved_comparisons
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  portfolio_ids UUID[] NOT NULL,
  period TEXT DEFAULT '1Y'
    CHECK (period IN ('1W', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'ALL')),
  metrics TEXT[] DEFAULT '{return_pct,sharpe,volatility,allocation}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_comparisons_user
  ON saved_comparisons (user_id);

ALTER TABLE saved_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY comparisons_all ON saved_comparisons
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 9. TABLA: leaderboard_cache
-- ============================================================
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  period TEXT NOT NULL,
  rankings JSONB NOT NULL DEFAULT '[]',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '1 hour',
  UNIQUE (category, period)
);

ALTER TABLE leaderboard_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY leaderboard_read ON leaderboard_cache
  FOR SELECT TO authenticated USING (true);
CREATE POLICY leaderboard_write ON leaderboard_cache
  FOR ALL TO service_role USING (true);

-- ============================================================
-- 10. TABLA: activity_feed
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'portfolio_created', 'portfolio_public',
    'position_opened', 'position_closed',
    'milestone_reached', 'streak_achieved',
    'comparison_shared', 'followed_user'
  )),
  metadata JSONB DEFAULT '{}',
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_user
  ON activity_feed (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_public
  ON activity_feed (created_at DESC) WHERE is_public = true;

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

CREATE POLICY activity_select ON activity_feed
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_public = true);
CREATE POLICY activity_insert ON activity_feed
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 11. ACTUALIZAR RLS POLICIES EXISTENTES
-- ============================================================

-- Profiles: permitir lectura pública (para descubrimiento social)
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT TO authenticated
  USING (true);

-- Portfolios: expandir SELECT para públicos y compartidos
DROP POLICY IF EXISTS portfolios_select ON portfolios;
CREATE POLICY portfolios_select ON portfolios
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL AND (
      user_id = auth.uid()
      OR visibility = 'public'
      OR (visibility = 'shared' AND EXISTS (
        SELECT 1 FROM portfolio_shares ps
        WHERE ps.portfolio_id = portfolios.id
        AND ps.shared_with_user_id = auth.uid()
        AND (ps.expires_at IS NULL OR ps.expires_at > now())
      ))
    )
  );

-- Positions: expandir para portafolios públicos visibles
DROP POLICY IF EXISTS positions_select ON positions;
CREATE POLICY positions_select ON positions
  FOR SELECT TO authenticated
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
    OR portfolio_id IN (
      SELECT id FROM portfolios
      WHERE visibility = 'public' AND show_positions = true AND deleted_at IS NULL
    )
    OR portfolio_id IN (
      SELECT p.id FROM portfolios p
      JOIN portfolio_shares ps ON ps.portfolio_id = p.id
      WHERE ps.shared_with_user_id = auth.uid()
      AND p.show_positions = true AND p.deleted_at IS NULL
    )
  );

-- Fix seguridad: company_data solo service_role puede escribir
DROP POLICY IF EXISTS company_data_auth_write ON company_data;
CREATE POLICY company_data_service_write ON company_data
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 12. FUNCIONES
-- ============================================================

-- Toggle follow con contadores atómicos
CREATE OR REPLACE FUNCTION toggle_follow(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_following BOOLEAN;
BEGIN
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot follow yourself';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM follows
    WHERE follower_id = auth.uid() AND following_id = target_user_id
  ) INTO is_following;

  IF is_following THEN
    DELETE FROM follows
    WHERE follower_id = auth.uid() AND following_id = target_user_id;
    UPDATE profiles SET follower_count = GREATEST(follower_count - 1, 0)
    WHERE user_id = target_user_id;
    UPDATE profiles SET following_count = GREATEST(following_count - 1, 0)
    WHERE user_id = auth.uid();
    RETURN false;
  ELSE
    INSERT INTO follows (follower_id, following_id)
    VALUES (auth.uid(), target_user_id);
    UPDATE profiles SET follower_count = follower_count + 1
    WHERE user_id = target_user_id;
    UPDATE profiles SET following_count = following_count + 1
    WHERE user_id = auth.uid();
    RETURN true;
  END IF;
END;
$$;

-- Toggle like con contador atómico
CREATE OR REPLACE FUNCTION toggle_portfolio_like(target_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_liked BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM portfolio_likes
    WHERE user_id = auth.uid() AND portfolio_id = target_portfolio_id
  ) INTO is_liked;

  IF is_liked THEN
    DELETE FROM portfolio_likes
    WHERE user_id = auth.uid() AND portfolio_id = target_portfolio_id;
    UPDATE portfolios SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = target_portfolio_id;
    RETURN false;
  ELSE
    INSERT INTO portfolio_likes (user_id, portfolio_id)
    VALUES (auth.uid(), target_portfolio_id);
    UPDATE portfolios SET like_count = like_count + 1
    WHERE id = target_portfolio_id;
    RETURN true;
  END IF;
END;
$$;

-- Auto-generar username al crear perfil
CREATE OR REPLACE FUNCTION generate_username()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base_name TEXT;
  final_name TEXT;
  counter INTEGER := 0;
BEGIN
  base_name := LOWER(REGEXP_REPLACE(
    COALESCE(NEW.display_name, 'investor'),
    '[^a-zA-Z0-9]', '', 'g'
  ));

  IF LENGTH(base_name) < 3 THEN
    base_name := 'investor';
  END IF;

  final_name := base_name;
  WHILE EXISTS(
    SELECT 1 FROM profiles WHERE username = final_name AND user_id != NEW.user_id
  ) LOOP
    counter := counter + 1;
    final_name := base_name || counter::TEXT;
  END LOOP;

  NEW.username := final_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_username_on_insert ON profiles;
CREATE TRIGGER set_username_on_insert
  BEFORE INSERT ON profiles
  FOR EACH ROW
  WHEN (NEW.username IS NULL)
  EXECUTE FUNCTION generate_username();

-- Trigger updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS portfolios_updated_at ON portfolios;
CREATE TRIGGER portfolios_updated_at
  BEFORE UPDATE ON portfolios
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Búsqueda fuzzy de usuarios
CREATE OR REPLACE FUNCTION search_users(
  search_query TEXT,
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  follower_count INTEGER,
  portfolio_count INTEGER,
  is_verified BOOLEAN,
  similarity_score REAL
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.follower_count,
    p.portfolio_count,
    p.is_verified,
    GREATEST(
      similarity(COALESCE(p.username, ''), search_query),
      similarity(COALESCE(p.display_name, ''), search_query)
    ) AS similarity_score
  FROM profiles p
  WHERE
    p.username IS NOT NULL
    AND (
      p.username % search_query
      OR p.display_name % search_query
    )
  ORDER BY similarity_score DESC
  LIMIT result_limit;
$$;

-- Discovery de portafolios públicos
CREATE OR REPLACE FUNCTION get_public_portfolios(
  sort_by TEXT DEFAULT 'return_pct',
  sort_order TEXT DEFAULT 'desc',
  asset_filter TEXT DEFAULT NULL,
  min_positions INTEGER DEFAULT 0,
  page_num INTEGER DEFAULT 1,
  page_size INTEGER DEFAULT 20
)
RETURNS TABLE (
  portfolio_id UUID,
  portfolio_name TEXT,
  owner_user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  total_return_pct NUMERIC,
  sharpe_ratio NUMERIC,
  volatility NUMERIC,
  position_count INTEGER,
  allocation JSONB,
  like_count INTEGER,
  view_count INTEGER,
  tags TEXT[],
  snapshot_date DATE,
  show_amounts BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    p.id AS portfolio_id,
    p.name AS portfolio_name,
    p.user_id AS owner_user_id,
    pr.username,
    pr.display_name,
    pr.avatar_url,
    s.total_return_pct,
    s.sharpe_ratio,
    s.volatility,
    s.position_count,
    s.allocation,
    p.like_count,
    p.view_count,
    p.tags,
    s.snapshot_date,
    p.show_amounts
  FROM portfolios p
  JOIN profiles pr ON pr.user_id = p.user_id
  LEFT JOIN LATERAL (
    SELECT * FROM portfolio_snapshots ps
    WHERE ps.portfolio_id = p.id
    ORDER BY ps.snapshot_date DESC
    LIMIT 1
  ) s ON true
  WHERE p.visibility = 'public'
    AND p.deleted_at IS NULL
    AND (asset_filter IS NULL OR p.tags @> ARRAY[asset_filter])
    AND COALESCE(s.position_count, 0) >= min_positions
  ORDER BY
    CASE WHEN sort_by = 'return_pct' AND sort_order = 'desc'
      THEN COALESCE(s.total_return_pct, -999999) END DESC NULLS LAST,
    CASE WHEN sort_by = 'return_pct' AND sort_order = 'asc'
      THEN COALESCE(s.total_return_pct, 999999) END ASC NULLS LAST,
    CASE WHEN sort_by = 'sharpe' AND sort_order = 'desc'
      THEN COALESCE(s.sharpe_ratio, -999999) END DESC NULLS LAST,
    CASE WHEN sort_by = 'likes' AND sort_order = 'desc'
      THEN p.like_count END DESC NULLS LAST,
    CASE WHEN sort_by = 'views' AND sort_order = 'desc'
      THEN p.view_count END DESC NULLS LAST,
    CASE WHEN sort_by = 'newest'
      THEN p.created_at END DESC
  LIMIT page_size
  OFFSET (page_num - 1) * page_size;
$$;

-- Generar usernames para usuarios existentes que no tienen uno
DO $$
DECLARE
  r RECORD;
  base_name TEXT;
  final_name TEXT;
  counter INTEGER;
BEGIN
  FOR r IN SELECT user_id, display_name FROM profiles WHERE username IS NULL LOOP
    base_name := LOWER(REGEXP_REPLACE(
      COALESCE(r.display_name, 'investor'),
      '[^a-zA-Z0-9]', '', 'g'
    ));
    IF LENGTH(base_name) < 3 THEN
      base_name := 'investor';
    END IF;
    final_name := base_name;
    counter := 0;
    WHILE EXISTS(SELECT 1 FROM profiles WHERE username = final_name AND user_id != r.user_id) LOOP
      counter := counter + 1;
      final_name := base_name || counter::TEXT;
    END LOOP;
    UPDATE profiles SET username = final_name WHERE user_id = r.user_id;
  END LOOP;
END;
$$;
