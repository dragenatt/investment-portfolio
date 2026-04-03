# InvestTracker - Plan Maestro: Comparativa Social de Portafolios

> **Fecha:** 2 de Abril, 2026
> **Proyecto:** portfolio-angello (Supabase ID: mabmqxztvakaijtrncyl)
> **Estado actual:** 8 usuarios, 4 portafolios, 12 posiciones, 8 transacciones
> **Versión:** 2.0

---

## Diagnóstico del Estado Actual

### Base de Datos (PostgreSQL 17 - Supabase us-east-1)

**Tablas existentes:** profiles, portfolios, positions, transactions, watchlists, watchlist_items, alerts, current_prices, price_history, company_data, market_events, failed_fetches

**Extensiones instaladas:** plpgsql, uuid-ossp, pgcrypto, pg_graphql, pg_stat_statements, supabase_vault

**Extensiones disponibles pero NO instaladas (necesarias):**
- `pg_cron` — Para jobs programados (la migración 004 lo referencia pero no se aplicó)
- `pg_net` — HTTP requests desde Postgres
- `pg_trgm` — Búsqueda por similitud (para buscar usuarios/portafolios)
- `pgmq` — Cola de mensajes (para notificaciones)

**Funciones existentes:** handle_new_user, update_updated_at

**Problemas detectados:**
1. No hay triggers activos en public (handle_new_user existe pero no está vinculado)
2. pg_cron y pg_net NO están instalados — el pipeline de precios automático no funciona
3. No hay índices en portfolios.user_id ni en profiles (solo PK)
4. Las RLS policies de company_data permiten ALL a authenticated (inseguro)
5. No hay tabla de snapshots de portafolio — los analytics se calculan on-the-fly cada vez
6. El Cloudflare Worker no está desplegado (0 workers), solo existe el KV namespace "price-engine-cache"

### Frontend (Next.js 16 + React 19)
- SWR para data fetching (buena base)
- Recharts para visualización
- shadcn/ui como design system
- Internacionalización en español
- Sin WebSockets ni real-time subscriptions de Supabase

### Infraestructura
- **Vercel:** Hosting del frontend
- **Supabase:** Base de datos + Auth + Edge Functions
- **Cloudflare:** KV namespace existe, Worker no desplegado
- **Upstash Redis:** Solo rate limiting actualmente

---

## Arquitectura Propuesta

### Cómo lo hicieron los grandes (y cómo aplicarlo)

**Facebook (2004):** Empezó con perfiles + muros. La clave fue el News Feed — ver qué hacen tus conexiones. **Aplicación:** Feed de actividad de portafolios que sigues.

**Instagram (2010):** Una acción simple (foto + filtro) + descubrimiento social. **Aplicación:** Cada portafolio es "una foto" — snapshot visual que puedes explorar, like, seguir.

**YouTube (2005):** Contenido público por defecto + sistema de rankings. **Aplicación:** Leaderboard de rendimiento + portafolios públicos como "contenido".

**eToro (2007):** CopyTrading — ver y replicar portafolios exitosos. **Aplicación:** Comparativa transparente con métricas profesionales.

### Principios de diseño
1. **Simple primero** — El usuario puede hacer su portafolio público con UN click
2. **Métricas, no montos** — Por defecto muestra %, no $
3. **Descubrimiento** — Los portafolios públicos deben ser fáciles de encontrar
4. **Gradual** — No necesitas registrarte para ver portafolios públicos (futuro)

---

## Fase 1: Fundación Social (Semana 1-2)

### 1.1 Migración de Base de Datos

**Archivo:** `supabase/migrations/005_social_foundation.sql`

Ver archivo completo en: `supabase/migrations/005_social_foundation.sql`

**Resumen de cambios:**
- 3 extensiones nuevas: pg_trgm, pg_cron, pg_net
- 7 tablas nuevas: follows, portfolio_likes, portfolio_snapshots, portfolio_shares, saved_comparisons, leaderboard_cache, activity_feed
- 2 tablas modificadas: profiles (+username, bio, contadores sociales), portfolios (+visibility, show_*, share_token)
- 5 funciones nuevas: toggle_follow, toggle_portfolio_like, generate_username, search_users, get_public_portfolios
- 3 triggers nuevos: set_username_on_insert, profiles_updated_at, portfolios_updated_at
- RLS policies actualizadas para soportar visibilidad pública/compartida
- Fix de seguridad en company_data (quitar write a authenticated)
- Índices nuevos para búsqueda fuzzy y discovery

### 1.2 Nuevos API Endpoints

```
POST   /api/social/follow          → toggle_follow(userId)
POST   /api/social/like            → toggle_portfolio_like(portfolioId)
GET    /api/social/feed             → activity feed del usuario + seguidos
GET    /api/social/search/users     → buscar usuarios
GET    /api/discover/portfolios     → portafolios públicos con filtros
GET    /api/discover/leaderboard    → rankings cacheados
GET    /api/portfolio/[id]/public   → vista pública de portafolio
PUT    /api/portfolio/[id]/visibility → cambiar visibilidad
POST   /api/portfolio/[id]/share    → generar/gestionar compartido
GET    /api/compare                 → comparar N portafolios
POST   /api/compare/save            → guardar comparación
GET    /api/profile/[username]      → perfil público de usuario
PUT    /api/profile/settings        → actualizar perfil social
```

### 1.3 Nuevas Páginas Frontend

```
/discover                → Explorar portafolios públicos + leaderboard
/discover/leaderboard    → Rankings detallados
/profile/[username]      → Perfil público
/portfolio/[id]/public   → Vista pública de portafolio
/compare                 → Herramienta de comparación
/compare/[id]            → Comparación guardada
/settings/privacy        → Configuración de privacidad
/settings/profile        → Editar perfil social
```

---

## Fase 2: Motor de Comparación (Semana 3-4)

### 2.1 Métricas de Comparación

Cada portafolio se compara usando estas métricas profesionales:

| Métrica | Fórmula | Descripción |
|---------|---------|-------------|
| Retorno Total % | (Valor Actual - Costo Total) / Costo Total × 100 | Ganancia/pérdida general |
| CAGR | (V_final / V_inicial)^(1/años) - 1 | Crecimiento anualizado |
| Sharpe Ratio | (Return - Risk Free) / σ | Retorno ajustado por riesgo |
| Volatilidad | σ anualizada de returns diarios | Riesgo del portafolio |
| Max Drawdown | (Valle - Pico) / Pico | Mayor caída desde máximo |
| Beta | Cov(port, market) / Var(market) | Sensibilidad al mercado |
| Alpha | Return - (Rf + β × (Rm - Rf)) | Retorno sobre el benchmark |
| Sortino Ratio | (Return - Rf) / σ_downside | Sharpe pero solo riesgo negativo |
| Diversificación | 1 - HHI (Herfindahl) | Qué tan diversificado está |
| Win Rate | Posiciones ganadoras / Total | % de posiciones en verde |

### 2.2 Vista de Comparación

La página `/compare` permite:
1. Seleccionar 2-5 portafolios (propios + públicos + compartidos)
2. Elegir período (1S, 1M, 3M, 6M, YTD, 1A, 3A, 5A, Todo)
3. Ver tabla comparativa con todas las métricas
4. Gráfica de rendimiento normalizada (base 100)
5. Radar chart de métricas de riesgo
6. Comparativa de asignación (stacked bar chart)
7. Benchmark contra S&P 500, IPC (BMV), Bitcoin

### 2.3 Sistema de Privacy Granular

El usuario controla por portafolio:

| Campo | Default | Descripción |
|-------|---------|-------------|
| visibility | private | public / private / shared |
| show_amounts | false | Mostrar montos en $ exactos? |
| show_positions | true | Mostrar qué activos tiene? |
| show_transactions | false | Mostrar historial de transacciones? |
| show_allocation | true | Mostrar % de asignación? |

Cuando `show_amounts = false`, los datos públicos solo muestran porcentajes.

---

## Fase 3: Infraestructura y Optimización (Semana 5-6)

### 3.1 Optimizar Supabase

**Índices faltantes críticos:**
```sql
CREATE INDEX idx_portfolios_user_deleted ON portfolios (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_positions_symbol ON positions (symbol);
CREATE INDEX idx_transactions_executed ON transactions (executed_at DESC);
CREATE INDEX idx_price_history_symbol_date ON price_history (symbol, date DESC);
```

### 3.2 Expandir Redis (Upstash)

**Estrategia de caching por capas:**

| Dato | TTL | Key Pattern | Tamaño estimado |
|------|-----|-------------|-----------------|
| Precios actuales | 60s | `price:{symbol}` | ~200 bytes |
| Leaderboard | 1h | `leaderboard:{category}:{period}` | ~5 KB |
| Perfil público | 5min | `profile:{username}` | ~500 bytes |
| Snapshot resumen | 15min | `snapshot:{portfolioId}:latest` | ~1 KB |
| Resultado comparación | 5min | `compare:{hash(ids+period)}` | ~3 KB |
| Feed actividad | 2min | `feed:{userId}:page:{n}` | ~2 KB |
| Búsqueda usuarios | 10min | `search:users:{query}` | ~2 KB |

### 3.3 Pipeline de Precios: Vercel Cron + Supabase Realtime

```json
// vercel.json - crons
{
  "crons": [
    { "path": "/api/cron/update-prices", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/compute-snapshots", "schedule": "0 22 * * 1-5" },
    { "path": "/api/cron/update-leaderboard", "schedule": "0 */1 * * *" }
  ]
}
```

**Cadena de fallback:** Yahoo Finance → Twelve Data → Finnhub → Redis cache

### 3.4 Desplegar Cloudflare Worker

Usar el KV namespace existente "price-engine-cache" como buffer entre APIs externas y Supabase.

---

## Fase 4: Snapshot Engine + Leaderboard (Semana 7-8)

### 4.1 Categorías de Ranking

| Categoría | Descripción |
|-----------|-------------|
| top_return_1m | Mayor retorno último mes |
| top_return_3m | Mayor retorno últimos 3 meses |
| top_return_1y | Mayor retorno último año |
| top_sharpe | Mejor Sharpe Ratio |
| top_diversified | Más diversificado (menor HHI) |
| top_consistent | Menor volatilidad con retorno positivo |
| top_risk_adjusted | Mejor Alpha |
| rising_stars | Mayor mejora en retorno (vs mes anterior) |

---

## Fase 5: Testing y CI/CD (Semana 9-10)

### 5.1 Estructura de Tests

```
tests/
├── unit/          → Fórmulas financieras, cache, validación
├── integration/   → API endpoints, RLS policies, funciones SQL
├── e2e/           → Flujos completos de comparación y privacidad
└── fixtures/      → Datos de prueba
```

### 5.2 GitHub Actions CI/CD

Pipeline: lint → type-check → test:unit → test:integration → build

---

## Resumen de Impacto

| Aspecto | Antes | Después |
|---------|-------|---------|
| Tablas | 12 | 19 (+7) |
| Funciones SQL | 2 | 7 (+5) |
| Endpoints API | ~20 | ~33 (+13) |
| Páginas | ~8 | ~16 (+8) |
| Cron Jobs | 0 funcionales | 3 |
| Cache Strategy | Solo rate limit | Multi-capa Redis |
| Test Coverage | Mínimo | Unit + Integration + E2E |
| CI/CD | Manual | GitHub Actions automatizado |

## Orden de Implementación

```
Semana 1:  Migración 005 + fix infra (extensiones, índices, RLS)
Semana 2:  Perfil social + sistema de visibilidad + share tokens
Semana 3:  Motor de snapshots + cron de cálculo
Semana 4:  Motor de comparación (API + frontend)
Semana 5:  Discovery page + leaderboard
Semana 6:  Follow system + activity feed
Semana 7:  Redis caching layer completo
Semana 8:  Pipeline de precios optimizado + Cloudflare Worker
Semana 9:  Testing (unit + integration)
Semana 10: CI/CD + polish + optimización
```
