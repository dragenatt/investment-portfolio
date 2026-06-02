# Justificación del Proyecto — InvestTracker

## 1. Identificación del Problema

### Problema Central
> **Los inversionistas individuales de habla hispana (con enfoque en México) no cuentan con una herramienta integral, accesible y en su idioma que les permita gestionar, analizar y dar seguimiento a sus portafolios de inversión de forma profesional.**

---

### Árbol de Problemas

```
                          ┌──────────────────────────────────────────┐
                          │            PROBLEMA CENTRAL              │
                          │  Gestión deficiente del portafolio de    │
                          │  inversión del inversionista individual  │
                          └───────────────────┬──────────────────────┘
                                              │
          ┌───────────────────────────────────┼────────────────────────────────┐
          ▼                                   ▼                                ▼
  EFECTO 1                           EFECTO 2                         EFECTO 3
  Toma de decisiones                 Pérdida de                       Desconocimiento
  financieras sin                    oportunidades de                 del riesgo real
  información real                   diversificación                  del portafolio
```

**Causas raíz identificadas:**

| # | Causa | Descripción |
|---|-------|-------------|
| C1 | Fragmentación de información | Los precios, historial y análisis están dispersos en múltiples plataformas |
| C2 | Herramientas en inglés | La mayoría de las plataformas profesionales no soportan español ni el mercado BMV |
| C3 | Costo de acceso | Los sistemas de análisis profesional son caros o de difícil acceso |
| C4 | Ausencia de métricas de riesgo | No hay herramientas que calculen volatilidad, Sharpe ratio y drawdown de forma accesible |
| C5 | Falta de historial integrado | Sin registro centralizado de transacciones, es imposible medir el rendimiento real |

---

## 2. Análisis de Involucrados

| Grupo | Rol | Interés principal | Impacto del proyecto |
|-------|-----|-------------------|----------------------|
| Inversionistas individuales (México) | Beneficiario directo | Conocer el rendimiento real de su dinero | Alto — acceso a herramientas profesionales |
| Usuarios de GBM+ y brokers mexicanos | Beneficiario directo | Importar y analizar sus trades fácilmente | Alto — integración CSV con GBM+ |
| Inversionistas con múltiples activos | Beneficiario directo | Consolidar acciones, ETFs, cripto, bonos, forex | Alto — soporte multi-activo y multi-moneda |
| Comunidad inversora hispanohablante | Beneficiario indirecto | Compartir estrategias y aprender entre pares | Medio — funciones sociales y leaderboards |
| Desarrollador/Equipo del proyecto | Ejecutor | Construir y mantener la plataforma | Alto — responsable técnico y operativo |

---

## 3. Árbol de Objetivos

```
                     ┌───────────────────────────────────────────┐
                     │            OBJETIVO CENTRAL               │
                     │  Proveer una plataforma integral en       │
                     │  español para la gestión profesional      │
                     │  de portafolios de inversión              │
                     └──────────────────┬────────────────────────┘
                                        │
        ┌───────────────────────────────┼────────────────────────────────┐
        ▼                               ▼                                ▼
RESULTADO 1                     RESULTADO 2                      RESULTADO 3
Decisiones de inversión         Diversificación                  Gestión activa
basadas en datos reales         informada y visualmente          y consciente del
y métricas calculadas           representada                     riesgo
```

**Medios para lograr los objetivos:**

| # | Medio | Componente técnico que lo satisface |
|---|-------|-------------------------------------|
| M1 | Precios en tiempo real multi-fuente | Worker en Cloudflare + APIs Twelve Data / Finnhub / Yahoo Finance |
| M2 | Métricas de riesgo calculadas | Volatilidad, Sharpe ratio, max drawdown en `/lib/services/analytics.ts` |
| M3 | Historial de transacciones centralizado | Tablas `transactions` y `positions` en Supabase (PostgreSQL) |
| M4 | Soporte mercado mexicano (BMV) | Bolsa Mexicana de Valores incluida, soporte MXN nativo |
| M5 | Importación desde brokers locales | Parser CSV compatible con GBM+ en `/utils/csv-parser.ts` |
| M6 | Asesor de inversiones automatizado | Cuestionario de perfil + simulaciones Monte Carlo en `/app/advisor` |
| M7 | Comunidad y transparencia | Portafolios públicos, leaderboards, actividad social |

---

## 4. Justificación del Proyecto

### 4.1 Pertinencia

La plataforma responde directamente a una necesidad real del mercado hispano. Mientras que herramientas como Bloomberg Terminal, Morningstar o Personal Capital están diseñadas para el mercado anglosajón, **el inversionista mexicano carece de un equivalente nativo**, accesible y con soporte para la BMV y el peso mexicano.

### 4.2 Relevancia Social

México cuenta con más de **6 millones de cuentas de inversión activas** en el INDEVAL y su comunidad de inversionistas retail ha crecido significativamente tras la popularización de plataformas como GBM+, Kuspit y BBVA Invest. Estos usuarios invierten pero no cuentan con las herramientas para analizar adecuadamente sus posiciones.

### 4.3 Pertinencia Técnica

El proyecto aprovecha tecnología moderna, confiable y escalable:

- **Next.js 16 + React 19**: Interfaz reactiva con Server-Side Rendering para tiempos de carga óptimos.
- **Supabase**: Base de datos PostgreSQL con autenticación y Row-Level Security que garantiza aislamiento de datos por usuario.
- **Cloudflare Workers**: Actualización de precios cada 5 minutos con alta disponibilidad y baja latencia global.
- **Sistema de resiliencia con circuit breakers**: Si una fuente de datos falla, el sistema conmuta automáticamente a las siguientes (Twelve Data → Finnhub → Yahoo Finance).

### 4.4 Viabilidad

| Dimensión | Evaluación |
|-----------|------------|
| **Técnica** | Alta — stack probado, arquitectura serverless, no requiere infraestructura propia |
| **Económica** | Alta — uso de servicios con nivel gratuito (Supabase, Vercel, Upstash) hasta escalar |
| **Operativa** | Alta — automatización de precios mediante cron jobs en el Worker |
| **Temporal** | Alta — desarrollo incremental por fases (Core → Analytics → Social) documentado en `/docs/superpowers/` |

### 4.5 Valor Diferencial frente a Alternativas

| Criterio | InvestTracker | Yahoo Finance | GBM+ App | Morningstar |
|----------|:---:|:---:|:---:|:---:|
| Interfaz en español | ✅ | Parcial | ✅ | ❌ |
| Soporte BMV | ✅ | Parcial | ✅ | ❌ |
| Métricas avanzadas (Sharpe, drawdown) | ✅ | ❌ | ❌ | ✅ |
| Multi-portafolio | ✅ | ❌ | ❌ | ✅ |
| Asesor de perfil inversor | ✅ | ❌ | Parcial | Parcial |
| Funciones sociales / comunidad | ✅ | ❌ | ❌ | ❌ |
| Gratuito | ✅ | ✅ | ✅ | ❌ |

---

## 5. Alcance del Proyecto

### Incluido en el proyecto
- Gestión de portafolios con múltiples tipos de activos (acciones, ETFs, bonos, cripto, forex, commodities).
- Seguimiento de precios en tiempo real (NYSE, NASDAQ, BMV).
- Análisis de rendimiento: TWR, MWR, atribución por sector, comparación con benchmarks (S&P 500, NASDAQ, IPC).
- Cálculo de métricas de riesgo: volatilidad, Sharpe ratio, máximo drawdown.
- Asesor de inversiones con simulaciones y recomendaciones de asignación de activos.
- Alertas de precio y listas de seguimiento (watchlists).
- Importación de transacciones desde GBM+ (CSV).
- Funciones sociales: portafolios públicos, leaderboards, seguimiento entre usuarios.
- Soporte multi-moneda (MXN, USD, EUR) con tipos de cambio en tiempo real.

### No incluido (fuera de alcance)
- Ejecución directa de órdenes de compra/venta (no es un broker).
- Integración con cuentas bancarias o instrumentos de deuda bancaria.
- Gestión de fondos de inversión colectiva (no es un robo-advisor regulado).
- Declaraciones fiscales automáticas (solo registro de transacciones).

---

## 6. Indicadores de Éxito

| Indicador | Descripción | Meta inicial |
|-----------|-------------|-------------|
| Usuarios registrados | Cuentas activas en la plataforma | 500 usuarios en 3 meses |
| Portafolios creados | Número de portafolios gestionados | 1,000 portafolios |
| Disponibilidad del servicio | Uptime de la plataforma | ≥ 99.5% |
| Tiempo de respuesta de precios | Latencia del endpoint de cotizaciones | < 800 ms promedio |
| Satisfacción del usuario | Reseñas o retroalimentación positiva | ≥ 4.0 / 5.0 |

---

*Documento elaborado con base en la metodología del Marco Lógico (Árbol de Problemas / Árbol de Objetivos) y técnicas de identificación de proyectos.*
