# InvestTracker: Migración Completa a VPS Propio

**Fecha:** 2026-04-03
**Estado:** Aprobado
**Equipo:** 2-3 estudiantes, nivel intermedio
**Presupuesto:** $5-15 USD/mes
**Plazo:** Sin fecha límite, migración incremental

---

## 1. Motivación

Transformar InvestTracker de un proyecto escolar desplegado en servicios gratuitos (Vercel + Supabase + Cloudflare Workers) a una plataforma con infraestructura propia para:

- **Costos controlados:** Eliminar dependencia de free tiers con límites impredecibles
- **Control total:** Administrar nuestro propio servidor, base de datos y servicios
- **Presentación profesional:** Demostrar capacidad de DevOps para tesis, concursos y portfolio
- **Escala:** Infraestructura que soporte crecimiento real de usuarios

---

## 2. Estado Actual

### Stack Actual
| Componente | Servicio | Costo |
|------------|----------|-------|
| Frontend + SSR | Vercel (free tier) | $0 |
| Base de datos | Supabase PostgreSQL (free tier) | $0 |
| Autenticación | Supabase Auth (free tier) | $0 |
| Price Engine | Cloudflare Worker + KV | $0 |
| Cache | Upstash Redis (free tier) | $0 |
| DNS | Cloudflare (free tier) | $0 |

### Tecnologías del Proyecto
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind + shadcn/ui
- **Backend:** Next.js API routes + Supabase client
- **Price Worker:** Cloudflare Worker (TypeScript) con Twelve Data + Finnhub
- **Database:** PostgreSQL via Supabase (RLS, functions, migrations)
- **Features:** Dashboard financiero, portfolios, watchlists, comparativa social, alertas, market data, i18n (ES/EN)

---

## 3. Arquitectura Objetivo

### 3.1 Diagrama General

```
Internet
   │
   ├── Cloudflare DNS (DNS-only mode, grey cloud)
   │     - Proxy mode OFF to allow direct SSL via certbot
   │     - DDoS protection via UFW rate limiting on VPS
   │
   └── VPS Hetzner CX22 (4GB RAM / 2 vCPU / 40GB SSD)
       │   Ubuntu 24.04 LTS
       │
       ├── Host-level services:
       │   ├── sshd (:22, key-only auth, fail2ban)
       │   ├── UFW firewall (ports 22, 80, 443 only)
       │   └── certbot (systemd timer for auto-renewal)
       │
       └── Docker Network "investtracker" (bridge, interna)
           ├── nginx       (:80/:443 → host ports, reverse proxy + SSL termination)
           ├── app         (:3000, Next.js standalone build)
           ├── postgres    (:5432, internal only)
           ├── redis       (:6379, internal only)
           └── price-worker (:3001, internal only)

Servicios externos:
   ├── Supabase Auth Cloud (se mantiene, free tier, 50K MAU)
   ├── Twelve Data API (precios primarios)
   ├── Finnhub API (precios fallback)
   └── Backblaze B2 (backups, ~$0.005/GB/mes)
```

**Nota sobre Cloudflare:** Se usa modo DNS-only (grey cloud, sin proxy) para que certbot pueda obtener certificados SSL via HTTP-01 challenge. Si en el futuro se activa proxy mode (orange cloud), habría que migrar a certificados edge de Cloudflare o DNS-01 challenge con API token.

### 3.2 Stack de Servicios (Docker Compose)

| Servicio | Imagen | Puerto | RAM |
|----------|--------|--------|-----|
| `app` | `node:22-alpine` + Next.js standalone | 3000 | ~512MB (limit: 1GB) |
| `postgres` | `postgres:17-alpine` | 5432 | ~256MB (limit: 512MB) |
| `redis` | `redis:7-alpine` | 6379 | ~64MB (limit: 128MB) |
| `price-worker` | `node:22-alpine` + node-cron | 3001 | ~128MB (limit: 256MB) |
| `nginx` | `nginx:alpine` | 80/443 | ~32MB (limit: 64MB) |

**Total estimado: ~1GB** de 4GB disponibles. Cada container tiene `mem_limit` en docker-compose para evitar que un servicio consuma toda la RAM. Certbot se ejecuta como systemd timer en el host (no en container) para simplificar la renovación de certificados.

**Requerimiento Next.js:** Se debe agregar `output: 'standalone'` a `next.config.ts` para generar un build auto-contenido sin necesidad de `node_modules` en el container.

### 3.2.1 Skeleton docker-compose.yml

```yaml
services:
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on: [app]
    mem_limit: 64m
    restart: unless-stopped

  app:
    build: { context: ., dockerfile: Dockerfile }
    expose: ["3000"]
    env_file: .env.production
    depends_on: [postgres, redis]
    mem_limit: 1g
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      retries: 3

  postgres:
    image: postgres:17-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: investtracker
      POSTGRES_USER: investtracker
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    mem_limit: 512m
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U investtracker"]
      interval: 10s
      retries: 5

  redis:
    image: redis:7-alpine
    mem_limit: 128m
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 3

  price-worker:
    build: { context: ./worker, dockerfile: Dockerfile }
    expose: ["3001"]
    env_file: .env.production
    depends_on: [postgres, redis]
    mem_limit: 256m
    restart: unless-stopped

volumes:
  pgdata:

networks:
  default:
    name: investtracker
```

### 3.3 Lo que se Elimina

| Servicio Cloud | Reemplazo Self-hosted |
|----------------|----------------------|
| Vercel (hosting) | Next.js en container Docker |
| Supabase PostgreSQL | PostgreSQL 17 en container |
| Cloudflare Workers + KV | Node.js service + Redis |
| Upstash Redis | Redis en container |

### 3.4 Lo que se Mantiene

| Servicio | Razón |
|----------|-------|
| Supabase Auth Cloud | Free tier soporta 50K MAU, evita complejidad de self-host auth |
| Cloudflare DNS (free) | Protección DDoS + DNS management sin costo |
| Twelve Data / Finnhub APIs | Fuentes de datos de mercado (no hay alternativa self-hosted) |

---

## 4. Plan de Migración

### Orden de Ejecución (secuencial)

```
Fase 1: Infraestructura base
  1. Provisionar VPS Hetzner + configurar Ubuntu
  2. Instalar Docker + Docker Compose
  3. Configurar firewall (UFW)
  4. Configurar SSH hardening

Fase 2: Servicios de datos
  5. Desplegar PostgreSQL en container
  6. Exportar datos de Supabase (pg_dump)
  7. Importar datos al PostgreSQL local
  8. Desplegar Redis en container

Fase 3: Aplicación
  9. Reescribir Price Worker (Cloudflare Worker → Node.js + node-cron)
  10. Adaptar código Next.js:
      - Supabase DB client → driver PostgreSQL directo (pg/postgres)
      - Upstash Redis → ioredis
      - Supabase Auth: mantener client, validar JWT con public key
  11. Crear Dockerfiles para app y price-worker
  12. Configurar docker-compose.yml

Fase 4: Exposición
  13. Registrar dominio
  14. Configurar Nginx + SSL (Let's Encrypt)
  15. Configurar Cloudflare DNS → IP del VPS

Fase 5: Operaciones
  16. Configurar backups automáticos (pg_dump + cron)
  17. Configurar CI/CD (GitHub Actions)
  18. Verificar todo funciona end-to-end
  19. Cortar servicios cloud antiguos
```

### 4.1 Migración de Base de Datos

**Exportar de Supabase:**
```bash
# Exportar schema + datos
pg_dump -h db.xxx.supabase.co -U postgres -d postgres \
  --no-owner --no-privileges \
  -F c -f investtracker_backup.dump

# Exportar schema por separado y committear al repo
pg_dump -h db.xxx.supabase.co -U postgres -d postgres \
  --schema-only --no-owner --no-privileges \
  -f supabase/schema.sql
```

**Importar al PostgreSQL local:**
```bash
pg_restore -h localhost -U postgres -d investtracker \
  --no-owner --no-privileges \
  investtracker_backup.dump
```

**Herramienta de migraciones:** Usar `dbmate` o archivos SQL versionados en `supabase/migrations/` para gestionar cambios de schema post-migración. Antes de comenzar, exportar y committear el schema completo actual como baseline.

### 4.1.1 Estrategia de Separación Auth/Data (CRÍTICO)

Actualmente el proyecto usa un solo Supabase client para **auth Y datos**. Post-migración serán dos clients separados:

**Patrón dual-client:**
```typescript
// Auth: sigue usando Supabase client (apunta a Supabase Cloud)
import { createServerClient } from '@supabase/ssr'
const supabaseAuth = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, ...)

// Data: nuevo driver PostgreSQL directo (apunta a PostgreSQL local)
import postgres from 'postgres'
const db = postgres(DATABASE_URL)
```

**Implicaciones de seguridad — RLS se pierde:**

Hoy, Supabase pasa el JWT del usuario a PostgreSQL y las RLS policies filtran datos por usuario. Al conectar directo con `postgres`, la app conecta como usuario de servicio — **todas las RLS policies son bypassed**.

**Solución: Authorization checks en la capa de aplicación.**
- Crear un middleware/helper que extraiga el `user_id` del JWT de Supabase Auth
- Cada query de datos incluye `WHERE user_id = $1` explícitamente
- Crear un wrapper o helper: `db.query('SELECT * FROM portfolios WHERE user_id = $1', [userId])`
- Auditar cada una de las ~104 llamadas `supabase.from()` / `supabase.rpc()` para asegurar que el filtro de usuario se aplica correctamente

**Funciones RPC a reescribir como SQL directo:**
1. `get_public_portfolios` → query SQL con joins
2. `soft_delete_portfolio` → `UPDATE portfolios SET deleted_at = NOW() WHERE id = $1 AND user_id = $2`
3. `search_users` → `SELECT FROM profiles WHERE name ILIKE $1`
4. `toggle_portfolio_like` → `INSERT/DELETE FROM portfolio_likes`
5. `toggle_follow` → `INSERT/DELETE FROM follows`

**Alcance estimado:** ~38 archivos de API routes, ~104 call sites a migrar.

### 4.1.2 Inventario de Variables de Entorno

| Variable (Antes) | Variable (Después) | Cambio |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` | Sin cambio (sigue apuntando a Supabase Cloud para auth) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sin cambio |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` | Sin cambio (para snapshots auth) |
| (nuevo) | `DATABASE_URL` | `postgresql://investtracker:PASSWORD@postgres:5432/investtracker` |
| `UPSTASH_REDIS_REST_URL` | `REDIS_URL` | `redis://redis:6379` |
| `UPSTASH_REDIS_REST_TOKEN` | (eliminado) | Redis local no necesita token |
| `TWELVE_DATA_API_KEY` | `TWELVE_DATA_API_KEY` | Sin cambio |
| `FINNHUB_API_KEY` | `FINNHUB_API_KEY` | Sin cambio |

### 4.2 Migración del Price Worker

**Antes (Cloudflare Worker):**
- `scheduled()` handler con cron triggers
- Cloudflare KV para cache
- `fetch()` handler para REST API
- `createClient(SUPABASE_URL, SERVICE_ROLE_KEY)` para escribir a DB

**Después (Node.js service):**
- `node-cron` para tareas programadas
- `ioredis` para cache
- Express/Fastify para REST API
- `postgres` driver directo para escribir a DB
- Mismos endpoints: `/health`, `/prices?symbols=`, `/price/:symbol`

**Operaciones de DB del worker que migran de Supabase client a PostgreSQL directo:**
- `upsert` a `company_data` (precios actualizados)
- `insert` a `price_history` (archivo diario)
- `insert` a `failed_fetches` (errores de fetch)
- `select` de `positions` (símbolos con posiciones abiertas)
- `select` de `watchlist_items` (símbolos en watchlist)

**También en el worker:** La cron de snapshots (`/api/cron/snapshots` en Vercel) se mueve al price-worker como un job adicional de `node-cron`. La lógica de `src/lib/services/snapshots.ts` se extrae y se adapta para usar el driver PostgreSQL directo.

### 4.3 Migración del Frontend

**Antes:** `next build` → Vercel serverless functions + Edge
**Después:** `next build` con `output: 'standalone'` → `next start` en container

**Cambios requeridos en código:**
1. Agregar `output: 'standalone'` a `next.config.ts`
2. Variables de entorno: `.env.production` en el VPS
3. Cron jobs (`/api/cron/snapshots`): movido a `node-cron` en el price-worker
4. Proxy/middleware (`src/proxy.ts`): adaptado para funcionar sin Vercel Edge
5. Reemplazar `@upstash/redis` con `ioredis` en `src/lib/cache/redis.ts`
6. Reemplazar `@upstash/ratelimit` con `rate-limiter-flexible` en `src/lib/api/rate-limit.ts`

### 4.4 Downtime Esperado por Deploy

El deploy con `docker compose pull && docker compose up -d` causa ~5-10 segundos de downtime por container de app. Para minimizar:
- Solo reiniciar containers de aplicación: `docker compose up -d --no-deps app price-worker`
- **Nunca reiniciar postgres y redis en deploys normales** — solo en actualizaciones de versión
- Aceptable para la fase actual del proyecto. Mejora futura: blue-green deploy con Traefik

---

## 5. Networking y Seguridad

### 5.1 Topología de Red

```
┌─────────────────────────────────────────────┐
│                   Internet                   │
└──────────────────────┬──────────────────────┘
                       │
            ┌──────────┴──────────┐
            │  Cloudflare DNS     │
            │  (DNS-only mode)    │
            └──────────┬──────────┘
                       │
┌──────────────────────┴──────────────────────┐
│              VPS (Host Level)                │
│                                              │
│  ┌────────────────────────────┐              │
│  │  UFW Firewall              │              │
│  │  22/tcp: SSH (key-only)    │              │
│  │  80/tcp: HTTP              │              │
│  │  443/tcp: HTTPS            │              │
│  └────────────┬───────────────┘              │
│               │                              │
│  ┌────────────┴───────────────────────────┐  │
│  │     Docker Network "investtracker"     │  │
│  │                                         │  │
│  │  ┌─────────┐     ┌──────────────┐      │  │
│  │  │  Nginx  │────→│  App (Next)  │      │  │
│  │  │ :80/:443│     │   :3000      │      │  │
│  │  └─────────┘     └──────┬───────┘      │  │
│  │                         │               │  │
│  │              ┌──────────┼──────────┐    │  │
│  │              │          │          │    │  │
│  │        ┌─────┴────┐ ┌──┴───┐ ┌────┴──┐ │  │
│  │        │PostgreSQL│ │Redis │ │Worker │ │  │
│  │        │  :5432   │ │:6379 │ │ :3001 │ │  │
│  │        └──────────┘ └──────┘ └───────┘ │  │
│  └─────────────────────────────────────────┘  │
│                                              │
│  Host services: sshd, certbot, cron (backups)│
└──────────────────────────────────────────────┘
```

**Solo Nginx expone puertos al host.** PostgreSQL, Redis y el price-worker son internos a la red Docker y no accesibles desde Internet.

### 5.2 Reglas de Firewall

```bash
# Default: deny all incoming
ufw default deny incoming
ufw default allow outgoing

# SSH (solo IPs conocidas si es posible)
ufw allow 22/tcp

# HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Habilitar
ufw enable
```

### 5.3 Hardening SSH

```
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
```

Instalar `fail2ban` para protección contra brute force.

### 5.4 Docker Network Isolation

Todos los containers en una red Docker interna. Solo Nginx expone puertos al exterior. PostgreSQL, Redis y el price-worker nunca son accesibles desde Internet.

### 5.5 Documentación en Packet Tracer

Crear en Cisco Packet Tracer:
- Topología completa del sistema con IPs, puertos y protocolos
- Flujo de una request HTTP del usuario hasta la DB
- Políticas de firewall documentadas
- Diagrama de disaster recovery (backup flow)

Este material se incluye en la documentación de tesis/concurso como evidencia de diseño de infraestructura.

---

## 6. CI/CD Pipeline

### GitHub Actions Workflow

```
Push a main
   │
   ├── Run tests (vitest)
   ├── Lint (eslint)
   │
   ├── Build Docker images (tagged with commit SHA)
   │   ├── ghcr.io/user/investtracker-app:abc1234
   │   ├── ghcr.io/user/investtracker-app:latest
   │   ├── ghcr.io/user/investtracker-worker:abc1234
   │   └── ghcr.io/user/investtracker-worker:latest
   │
   ├── Push to GitHub Container Registry (ghcr.io)
   │
   └── Deploy via SSH
       ├── docker compose pull
       └── docker compose up -d --no-deps app price-worker
```

**Imágenes taggeadas con commit SHA** para mantener historial y facilitar rollback.

**Rollback:** Editar docker-compose para usar el tag del commit anterior, luego `docker compose pull && docker compose up -d --no-deps app price-worker`.

**Nota:** Solo se reinician `app` y `price-worker` en deploys normales. `postgres`, `redis` y `nginx` no se tocan.

---

## 7. Profesionalización

### 7.1 Dominio y SSL
- Registrar dominio (~$10/año)
- DNS en Cloudflare free tier (modo DNS-only / grey cloud)
- SSL con certbot en el VPS:
  - Método: HTTP-01 challenge (requiere Cloudflare en DNS-only mode)
  - Renovación: systemd timer automático (certbot instala uno por defecto)
  - Post-renewal hook: `nginx -s reload` para cargar el certificado nuevo

### 7.2 Documentación
- README profesional con arquitectura, setup, screenshots
- ADRs (Architecture Decision Records) para decisiones clave
- Diagramas de Packet Tracer como imágenes en el repo

### 7.3 Testing
- Unit tests con Vitest (ya configurado)
- Integration tests para API routes
- E2E tests con Playwright (flujos críticos)

### 7.4 Backups
- `pg_dump` diario vía cron del host
- Retención: 7 días rolling
- Almacenamiento: Backblaze B2 ($0.005/GB/mes) o almacenamiento local

---

## 8. Mejoras Post-Migración

Una vez estable en el VPS, se desbloquean capacidades que antes no eran posibles:

| Mejora | Descripción |
|--------|-------------|
| WebSockets | Precios en tiempo real (sin polling) |
| Background Jobs | Análisis técnico complejo, ML predictions |
| Storage propio | Exportar PDFs de reportes |
| Rate limiting granular | Control fino por usuario/endpoint |
| Monitoreo (Grafana) | Dashboard de salud del sistema |
| Segundo VPS | Load balancing cuando sea necesario |

---

## 9. Estimación de Costos

### Costos Mensuales Objetivo

| Recurso | Costo/mes |
|---------|-----------|
| VPS Hetzner CX22 (4GB/2vCPU/40GB) | ~$5.50 |
| Dominio (anualizado) | ~$0.83 |
| Backblaze B2 backups (~1GB) | ~$0.01 |
| **Total** | **~$6.34/mes** |

### Comparado con Escalar en Cloud

Si el proyecto crece con los servicios actuales:
- Vercel Pro: $20/mes
- Supabase Pro: $25/mes
- Upstash Pro: $10/mes
- Cloudflare Workers Paid: $5/mes
- **Total cloud: ~$60/mes**

El VPS ofrece más capacidad por ~10% del costo.

---

## 10. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| VPS cae | Baja | Alto | Backups diarios, documentación de recovery |
| DB corrupta | Muy baja | Crítico | pg_dump diario + test de restore mensual |
| SSH comprometido | Baja | Crítico | Key-only, fail2ban, puertos mínimos |
| Disco lleno | Media | Medio | Monitoreo básico, log rotation |
| Migración rompe algo | Alta | Medio | Migración incremental, mantener cloud activo hasta verificar |

---

## Apéndice: Proveedor de VPS Alternativo

Si Hetzner no está disponible en su región:
- **DigitalOcean:** $6/mes (1GB) o $12/mes (2GB) — más caro pero US-based
- **Vultr:** $6/mes (1GB) o $12/mes (2GB) — similar a DO
- **Oracle Cloud Free Tier:** ARM instance gratis (4 OCPU, 24GB RAM) — gratuito pero setup complejo
