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
   ├── Cloudflare DNS (free tier: DNS + DDoS protection)
   │
   └── VPS Hetzner CX22 (4GB RAM / 2 vCPU / 40GB SSD)
       │   Ubuntu 24.04 LTS
       │
       ├── Nginx (reverse proxy + SSL via Let's Encrypt)
       │   ├── :443 → app:3000 (Next.js)
       │   ├── :80  → redirect :443
       │   └── :22  → SSH (key-only, solo IPs autorizadas)
       │
       └── Docker Network (172.18.0.0/16, interna)
           ├── app         (Next.js build, port 3000)
           ├── postgres    (PostgreSQL 17, port 5432)
           ├── redis       (Redis 7, port 6379)
           ├── price-worker (Node.js + node-cron, port 3001)
           └── nginx       (port 80/443, expuesto al exterior)

Servicios externos:
   ├── Supabase Auth Cloud (se mantiene, free tier, 50K MAU)
   ├── Twelve Data API (precios primarios)
   ├── Finnhub API (precios fallback)
   └── Backblaze B2 (backups, ~$0.005/GB/mes)
```

### 3.2 Stack de Servicios (Docker Compose)

| Servicio | Imagen | Puerto | RAM |
|----------|--------|--------|-----|
| `app` | `node:22-alpine` + Next.js build | 3000 | ~512MB |
| `postgres` | `postgres:17-alpine` | 5432 | ~256MB |
| `redis` | `redis:7-alpine` | 6379 | ~64MB |
| `price-worker` | `node:22-alpine` + node-cron | 3001 | ~128MB |
| `nginx` | `nginx:alpine` + certbot | 80/443 | ~32MB |

**Total estimado: ~1GB RAM** de 4GB disponibles.

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
pg_dump -h db.xxx.supabase.co -U postgres -d postgres \
  --no-owner --no-privileges \
  -F c -f investtracker_backup.dump
```

**Importar al PostgreSQL local:**
```bash
pg_restore -h localhost -U postgres -d investtracker \
  --no-owner --no-privileges \
  investtracker_backup.dump
```

**Cambios en código:**
- Reemplazar `@supabase/supabase-js` (para queries de datos) con `postgres` (driver directo) o Drizzle ORM
- Mantener `@supabase/supabase-js` solo para Auth (login, signup, session)
- Migrar todas las llamadas `supabase.from('table').select()` a queries SQL

### 4.2 Migración del Price Worker

**Antes (Cloudflare Worker):**
- `scheduled()` handler con cron triggers
- Cloudflare KV para cache
- `fetch()` handler para REST API

**Después (Node.js service):**
- `node-cron` para tareas programadas
- `ioredis` para cache
- Express/Fastify para REST API
- Mismos endpoints: `/health`, `/prices?symbols=`, `/price/:symbol`

### 4.3 Migración del Frontend

**Antes:** `next build` → Vercel serverless functions + Edge
**Después:** `next build` → `next start` en container (Node.js standalone)

**Cambios:**
- Variables de entorno: `.env.production` en el VPS
- Cron jobs (`/api/cron/snapshots`): movido a `node-cron` en el price-worker
- Proxy/middleware: adaptado para funcionar sin Vercel Edge

---

## 5. Networking y Seguridad

### 5.1 Topología de Red

```
┌─────────────────────────────────────────────┐
│                   Internet                   │
└──────────────────────┬──────────────────────┘
                       │
            ┌──────────┴──────────┐
            │   Cloudflare DNS    │
            │  (DDoS + DNS only)  │
            └──────────┬──────────┘
                       │
            ┌──────────┴──────────┐
            │   VPS Firewall      │
            │   (UFW/iptables)    │
            │  22: SSH (key-only) │
            │  80: HTTP → 443     │
            │  443: HTTPS         │
            └──────────┬──────────┘
                       │
            ┌──────────┴──────────┐
            │      Nginx          │
            │  SSL Termination    │
            │  Reverse Proxy      │
            └──────────┬──────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────┴────┐  ┌─────┴─────┐ ┌────┴────────┐
    │  App    │  │ PostgreSQL│ │Price Worker │
    │ :3000   │  │  :5432    │ │   :3001     │
    └────┬────┘  └───────────┘ └──────┬──────┘
         │                            │
         └────────────┬───────────────┘
                      │
                ┌─────┴─────┐
                │   Redis   │
                │   :6379   │
                └───────────┘
```

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
   ├── Build Docker images
   │   ├── investtracker-app:latest
   │   └── investtracker-worker:latest
   │
   ├── Push to GitHub Container Registry (ghcr.io)
   │
   └── Deploy via SSH
       ├── docker compose pull
       └── docker compose up -d
```

**Rollback:** Re-tag la imagen anterior como `:latest` y `docker compose pull`.

---

## 7. Profesionalización

### 7.1 Dominio
- Registrar dominio (~$10/año)
- DNS en Cloudflare free tier
- SSL automático con certbot

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
