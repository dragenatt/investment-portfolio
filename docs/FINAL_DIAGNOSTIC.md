# DIAGNÓSTICO FINAL — InvestTracker

**Fecha:** 2026-09-16 · **Commit auditado:** `badb90f` · **Rama:** `master`
**Naturaleza:** auditoría de solo lectura. No se modificó código, componentes, APIs, tests,
configuración ni base de datos. El único archivo creado es este documento.

---

## 0. Fuente de verdad utilizada, y una advertencia

El prompt de diagnóstico nombra cuatro documentos: *Investtracker posibles cambios*,
*Investtracker posibles cambios(2)*, *CAMBIOSINVESTT* y *Últimos cambios INVEST TRACKER*.
**Ninguno de los cuatro existe en este entorno.** Se buscó en `Documents`, `Downloads`,
`Desktop`, `OneDrive` y la bóveda Obsidian.

El único documento de especificación presente es:

- `C:\Users\ponye\Documents\Codex\2026-09-08\ha\outputs\Cambios Invest tracker.md` (3.295 líneas, 56 KB)
- copia PDF en `C:\Users\ponye\Downloads\Cambios Invest tracker.pdf`

Contiene exactamente **95 tareas en 8 olas** con los IDs `P0-1..P0-28`, `P1-1..P1-33`,
`P2-1..P2-10`, `D1..D12`, `E1..E3`, `C1..C9`. Esa es la fuente usada. Los IDs se conservan
literalmente. **Si los cuatro documentos citados contienen requisitos distintos, esta
auditoría no los cubre**, y habría que repetirla con ellos a la vista.

---

## 1. RESUMEN EJECUTIVO (20 puntos)

1. **El motor financiero es sólido y está bien probado.** 2.081 tests pasan, `tsc` limpio,
   `npm run build` limpio, `eslint` 0 errores (45 warnings). Se ejecutaron además 10 pruebas
   independientes contra el motor real, escritas para esta auditoría: las 10 pasan.
2. **P0-21 (recomendación circular) está resuelto de verdad.** Verificado en el motor y
   *en la interfaz*: con $1.000 recomienda $5.810; al reintroducir $5.810 la app responde
   «Ya es suficiente para el objetivo de confianza: no necesitas aportar mas» (75,8%).
   No vuelve a pedir más. **No es CRÍTICO.**
3. **No hay look-ahead bias en el backtesting.** Truncando la serie a 250 de 400 barras,
   cada entrada del run truncado reaparece en la misma fecha en el run completo.
4. **El Strategy Sandbox ejecuta de verdad la regla del usuario.** 249 barras comparadas
   contra una implementación independiente del cruce SMA20/SMA50: 0 discrepancias.
5. **PCA es correcto:** activos perfectamente correlacionados → exactamente 1 apuesta
   efectiva; 3 activos independientes → 3,000. La varianza explicada suma 100%.
6. **Monte Carlo correlacionado es correcto y reproducible:** la banda P10–P90 de un par
   negativamente correlacionado (0,074) es 8 veces más estrecha que la del par idéntico
   (0,613); misma semilla → distribución idéntica; ninguna trayectoria ≤ 0.
7. **Risk Parity iguala el riesgo exactamente** (33,33% / 33,33% / 33,33%). Markowitz
   reproduce la solución analítica de mínima varianza de 2 activos con 4 decimales.
8. **Pero Markowitz y CVaR NO implementan las restricciones que la especificación exige.**
   No existe parámetro `minWeight`, `maxWeight` ni `sectorCaps` en ninguna firma, y CVaR no
   acepta retorno mínimo. Un solve sin restricciones entrega 100% en un solo activo.
9. **El hallazgo estructural más grande: hay funcionalidad terminada que la interfaz nunca
   muestra.** 11 endpoints funcionan, devuelven datos reales y no tienen ningún consumidor
   en el frontend.
10. **Cuatro servicios completos están huérfanos** (cero importadores fuera de sus propios
    tests): `rebalance.ts`, `what-if.ts`, `freshness.ts`, `concentration.ts`.
11. **Metas (P1-8/P1-9) tienen tabla, RLS, API, servicio y tests — y ninguna pantalla.**
    `goals` y `goal_projections` tienen 0 filas. El Advisor calcula la meta en memoria y
    nunca la guarda.
12. **El centro de notificaciones y el audit trail de usuario nunca se activan.**
    `notifications` y `audit_log` tienen 0 filas y no existe UI para ninguno.
13. **`portfolio_snapshots` está vacía (0 filas).** El cron nocturno terminó en estado
    `running` las noches del 12, 13, 14 y 15 de septiembre. La corrección se publicó el 15
    durante el día; la primera ejecución con el arreglo sería la del 16 a las 01:00 UTC y
    aún no ha ocurrido. `daily_baselines` sí cierra correctamente desde el 15 (107
    procesados / 7 fallidos).
14. **Los background jobs funcionan:** 42 trabajos, **todos** en `completed`, ninguno atascado
    en `processing`. Pero solo 3 de los 5 tipos que pide C1 se disparan desde la interfaz.
15. **P2-10 (auditabilidad) está completo:** las 19 rutas de analytics devuelven `_meta` con
    modelo, versión, origen del precio y si vino de caché. Verificado una por una.
16. **Seguridad correcta:** RLS activo en las 33 tablas públicas; las 3 tablas de
    observabilidad tienen RLS sin políticas (deny-all, solo service role). Ningún secreto en
    variables `NEXT_PUBLIC_*`. `.env.local` ignorado por git.
17. **Defecto de contrato en la pestaña Asignación:** la API devuelve `bySector[].name` y la
    página lee `s.sector`, así que las tres barras de sector se dibujan **sin etiqueta**.
    Es el mismo tipo de error que el de la pestaña Ingresos corregido esta semana.
18. **Tres cifras distintas para «la peor caída» en la misma pantalla:** 8,72% (ruta risk),
    8,2% (diagnóstico) y 8,7% (Portfolio Health), con dos rangos de fechas distintos. Cada
    una es defendible por separado; ninguna dice al lector que mide otra cosa.
19. **P0-23 no cumple «common random numbers» entre ejecuciones.** La semilla se deriva de
    los parámetros e incluye la aportación y el horizonte, así que comparar $1.000 contra
    $2.000 —el caso exacto que la tarea nombra— usa shocks distintos. Dentro de una misma
    ejecución sí son comunes, que es lo que hace que P0-21 funcione.
20. **Veredicto: 🟡 CASI LISTO.** El motor es confiable; el problema es de *integración* y
    de *restricciones faltantes en optimización*, no de aritmética.

---

## 2. PORCENTAJE REAL DE CUMPLIMIENTO

| Estado | Tareas | Ponderación aplicada |
|---|---:|---|
| COMPLETA | 63 | 100% cada una |
| IMPLEMENTADA CON DEFECTOS | 12 | 60–90% según gravedad |
| PARCIAL | 20 | 35–70% según lo que falta |
| NO IMPLEMENTADA | 0 | — |
| NO VERIFICABLE (tarea entera) | 0 | — |

**Cómo se calculó:** se sumó el porcentaje asignado a cada tarea individualmente (columna
«%» de la matriz de la sección 4) y se dividió entre 95 × 100.

```
COMPLETA            63 × 100                        = 6.300
CON DEFECTOS        75+80+70+70+90+60+70+70+70+80+85+70 =   890
PARCIAL             60+40+40+40+50+50+60+55+50+35+35+60+60+60+40+55+45+50+60+70 = 1.015
                                                      -------
                                              TOTAL =  8.205  / 9.500
```

## **CUMPLIMIENTO REAL: 86,4%**

No se contó por archivos existentes. Una tarea con servicio, endpoint y tests pero sin
interfaz se puntuó entre 35% y 60%, porque el criterio 4 del propio roadmap («la UI la
utiliza cuando corresponde») no se cumple.

**Elementos no verificables por separado** (no restan del porcentaje, se listan en §21):
contenido de `/admin/metrics`, instalación PWA en dispositivo real, 9 pruebas E2E
autenticadas, y comportamiento del cron nocturno tras la corrección.

---

## 3. ARQUITECTURA AUDITADA

```
388 archivos TS/TSX · 77 servicios · 78 rutas API · 103 componentes · 24 hooks
111 archivos de test (2.081 tests) · 20 migraciones · 14 documentos · 1 Cloudflare Worker
```

La arquitectura objetivo del roadmap **sí existe** y es coherente:

| Capa | Evidencia |
|---|---|
| PORTFOLIO | `portfolio.ts`, `portfolio-history.ts`, `portfolio-series.ts`, `transaction.ts`, `pnl.ts` |
| MARKET | `market.ts` + `twelve-data.ts` + `finnhub.ts` con `resilience.ts` (circuit breakers), `price-history.ts` |
| ADVISOR | `advisor.ts` + 5 módulos satélite, versión de modelo `2.1.0` |
| EDUCATION | `lab.ts` (14 experimentos), `metric-explanations.ts` |
| FINANCIAL ENGINE | `analytics.ts`, `returns.ts`, `var.ts`, `drawdown.ts`, `covariance.ts`, `monte-carlo.ts`, `optimizer.ts`, `allocation-strategies.ts`, `black-litterman.ts`, `robust-optimizer.ts`, `backtest.ts`, `attribution.ts`, `risk-attribution.ts`, `factors.ts`, `pca.ts`, `rolling-metrics.ts`, `stress-testing.ts`, `scenario-engine.ts` |
| DATA QUALITY | `data-quality.ts`, `corporate-actions.ts`, `freshness.ts` |
| JOBS / REALTIME | `jobs.ts` + `lib/jobs/kinds/*`, `live-prices.ts` (Supabase Realtime) |
| SECURITY | RLS en 33/33 tablas, `proxy.ts` (CSP con nonce + rate limiting), `validation.ts` |

**Veredicto arquitectónico:** las funcionalidades nuevas NO se agregaron de forma aislada.
El motor es compartido y reutilizado (`risk-inputs.ts` alimenta por igual a riesgo, salud,
diagnóstico y escenarios). El problema no es arquitectura: es **cableado hacia la interfaz**.

### Servicios huérfanos (cero importadores fuera de su propio archivo y tests)

| Servicio | Tarea | Líneas | Tests |
|---|---|---:|---|
| `src/lib/services/rebalance.ts` | P0-12, P1-10 | 430 | sí |
| `src/lib/services/what-if.ts` | P1-15 | — | sí |
| `src/lib/services/freshness.ts` | P0-9 | — | sí |
| `src/lib/services/concentration.ts` | — | — | — |

### Endpoints sin ningún consumidor en el frontend

`/api/goals`, `/api/goals/[id]`, `/api/notifications`, `/api/audit`,
`/api/portfolio/[id]/trade-history`, `/api/portfolio/[id]/export`,
`/api/market/[symbol]/data-quality`, `/api/market/[symbol]/backtest`,
`/api/analytics/[pid]/stress`, `/api/analytics/[pid]/exposure`,
`/api/analytics/[pid]/benchmark`, `/api/analytics/[pid]/backtest`,
`/api/analytics/[pid]/performance`.

Todos responden **200 con datos reales** (verificado). No es que estén rotos: es que nadie
los llama.

**En el sentido contrario no hay ningún caso:** no existe ninguna referencia del cliente a
una ruta inexistente.

---

## 4. MATRIZ DE LAS 8 OLAS

Leyenda: **C**=COMPLETA · **D**=IMPLEMENTADA CON DEFECTOS · **P**=PARCIAL · **NI**=NO IMPLEMENTADA · **NV**=NO VERIFICABLE

### OLA 1 — Fundamentos y correcciones críticas

| ID | Tarea | Est. | % | Implementación | Integración | Tests | Evidencia / Problemas |
|---|---|---|---:|---|---|---|---|
| P0-1 | Monte Carlo correlacionado | C | 100 | `covariance.ts`, `monte-carlo.ts` | ruta + `monte-carlo-chart` + job | sí | Probe: banda negativa 0,074 vs idéntica 0,613; misma semilla = idéntico; 0 trayectorias ≤0 |
| P0-2 | Beta/Alpha/Benchmark unificado | C | 100 | `calculateBetaAlpha` en `analytics.ts` | risk + snapshots | golden | Beta 1/2/−1 exactos; aproximación vol/vol **eliminada** (grep sin resultados) |
| P0-3 | Precisión monetaria | C | 100 | `utils/money.ts` | advisor + pnl | sí | golden «splits a total without losing a cent» |
| P0-4 | Observabilidad de producción | D | 75 | Sentry configs, `error_events`, `/admin/metrics` | parcial | sí | 63 errores capturados; **`funnel_events` solo 2 filas**; PostHog/Sentry sin claves locales; `/admin/metrics` 404 sin `ADMIN_EMAILS` |
| P0-5 | Tasa libre por moneda | C | 100 | `risk-free-rate.ts` (MXN/USD/EUR, caché 24h, `isFallback`) | 13 consumidores | sí | Sin `0.10` universal |
| P0-6 | Data Quality Engine | P | 60 | `data-quality.ts` + `docs/DATA_QUALITY.md` | ruta OK, **sin UI** | sí | `/api/market/AAPL/data-quality` → 200 con 7 campos; ninguna pantalla lo muestra |
| P0-7 | Corporate actions | C | 100 | `corporate-actions.ts`, `adjustSeriesBySymbol` | `price-history.ts` | golden | Split 4:1 reexpresado correctamente |
| P0-8 | Proveedores con fallback | C | 100 | `market.ts` TD→Finnhub→Yahoo + `resilience.ts` | todas las lecturas | sí | Circuit breakers con estado expuesto |
| P0-9 | Frescura de datos | P | 40 | `freshness.ts` (live/delayed/cached/unavailable) | **huérfano** | sí | La UI usa 2 banderas binarias ad-hoc: `allocation/route.ts:61` y `portfolio.ts:124` |
| P0-10 | Atribución de rendimiento | C | 100 | `attribution.ts` | ruta + waterfall + pestaña | sí | Verificado en pantalla |
| P0-11 | Atribución de riesgo | C | 100 | `risk-attribution.ts` | risk + `risk-sources` | golden | Identidad de Euler probada |
| P0-12 | Rebalanceo inteligente | P | 40 | `rebalance.ts` (desviación/bandas/calendario/riesgo) | **huérfano** | sí | Cero importadores. El diagnóstico reimplementa el concepto en `portfolio-diagnostic.ts:301` |
| P0-13 | TWR y MWR/XIRR | C | 100 | `returns.ts` | pestaña General | golden | Probe: TWR 100,0000% vs XIRR 17,1124% |
| P0-14 | Benchmark configurable | P | 40 | ruta acepta `?vs=` | **sin selector ni persistencia** | sí | No existe columna `benchmark` en `portfolios`; todo usa `'SPY'` |
| P0-15 | Drawdown analysis | C | 100 | `drawdown.ts` | risk + underwater chart | sí | Verificado en pantalla |
| P0-16 | Auditoría de acciones | P | 50 | `audit.ts` + `/api/audit` | **sin UI** | sí | `audit_log` = **0 filas** |
| P0-17 | Financial Regression Suite | C | 100 | `tests/financial-regression/golden.test.ts` (406 líneas) | `npm run test:financial` en CI | — | Cubre las 12 métricas listadas |
| P0-18 | Validación matemática global | C | 100 | `validation.ts` | `sanitizeFinancialPayload` en `lib/api/response.ts` | sí | Aplicado a **toda** respuesta API |
| P0-19 | Centro de notificaciones | P | 50 | `notifications.ts` + ruta | **sin UI** | sí | Tabla con **0 filas** |
| P0-20 | Motor financiero centralizado | D | 80 | `docs/FINANCIAL_ASSUMPTIONS.md` (304 líneas) | parcial | sí | **`TRADING_DAYS = 252` declarado en 19 archivos distintos**; `analytics.ts` lo escribe literal dos veces (líneas 12 y 28) teniendo la constante en la línea 54 |
| P0-21 | Corregir recomendación circular | C | 100 | `aporteParaProbabilidadMeta` (bisección sobre el MISMO set) | advisor | sí | **Verificado en motor y en UI** (ver §5) |
| P0-22 | Separar métricas del Advisor | C | 100 | `PlanOutcome` | advisor | sí | Determinista y simulado mostrados por separado con explicación del volatility drag |
| P0-23 | Monte Carlo reproducible | D | 70 | `buildScenarios`, `extendScenarios` | advisor | sí | CRN **dentro** de una ejecución sí; **entre** ejecuciones no: `seedFor(capitalInicial, aportacionMensual, horizonte, meta, nivel)` en `advisor/page.tsx:424` |
| P0-24 | Validación financiera de inputs | C | 100 | `validarEntradasAdvisor` | front + server | sí | Tests de frontera |
| P0-25 | Auditoría de cartera sugerida | C | 100 | `auditarCartera` + `allocateMoney` | advisor | sí | Verificado: 20k+20k+35k+15k+10k = 100k; 200+200+350+150+100 = 1.000 |
| P0-26 | Suite financiera del Advisor | C | 100 | property tests | — | sí | Probe: monotonía, orden de percentiles, finitud, reproducibilidad |
| P0-27 | Precisión monetaria del Advisor | C | 100 | `advisorInternals.toCents` | advisor | sí | Sin `$999.9999999997` en pantalla |
| P0-28 | Versionado del modelo | D | 70 | `ADVISOR_MODEL_VERSION 2.1.0` + doc | metadata sí | sí | **Nada se guarda**: `goal_projections` = 0 filas. No hay proyecciones históricas que versionar |

### OLA 2 — Analítica avanzada

| ID | Tarea | Est. | % | Evidencia / Problemas |
|---|---|---|---:|---|
| P1-1 | Backtesting walk-forward | D | 90 | Sin look-ahead (probe). `docs/BACKTEST_RESULTS.md` existe. `/api/market/[symbol]/backtest` sin consumidor (la UI usa `/strategy`, mismo motor) |
| P1-2 | VaR Cornish-Fisher | C | 100 | `var.ts` skew/kurtosis/CF; golden fija 1,6449σ; ambos VaR en el risk dashboard |
| P1-3 | Playwright E2E | D | 60 | 19 tests: **10 pasan, 9 omitidos** (faltan `E2E_EMAIL`/`E2E_PASSWORD`). CI los ejecuta |
| P1-4 | Sensibilidad de metas | C | 100 | `analizarSensibilidad` con escenarios comunes; visible en el Advisor |
| P1-5 | Comparador de estrategias | P | 60 | `compararEstrategias` + tests; **ningún componente lo llama** |
| P1-6 | Fecha estimada de meta | C | 100 | `proyectarFechaMeta` (P25/mediana/P75 + nunca alcanzan) |
| P1-7 | Consistencia del Advisor | C | 100 | `verificarConsistencia` ejecutado antes de mostrar |
| P1-8 | Historial de metas | P | 55 | Migración 014, RLS (4 políticas), API CRUD, servicio, tests. **Sin UI. 0 filas** |
| P1-9 | Seguimiento real de metas | P | 50 | `goalProgress`, `classifyPace` (ahead/on-track/behind). **Sin UI** |
| P1-10 | Simulador de rebalanceo | P | 35 | `simulateRebalance` completo y probado. **Huérfano** |
| P1-11 | Comparador de activos | C | 100 | `/market/compare` + ruta + gráfico normalizado |
| P1-12 | Tracking Error / IR | C | 100 | Dentro de `calculateBetaAlpha`; mostrados y explicados |
| P1-13 | Análisis de recuperación | C | 100 | `recoveryProfile`; golden fija la asimetría −23% → +29,9% |
| P1-14 | Laboratorio financiero | C | 100 | Superado por E1 (14 experimentos) |
| P1-15 | ¿Qué pasaría si…? | P | 35 | `what-if.ts` + tests. **Huérfano**. Parcialmente suplido por Escenarios |
| P1-16 | Explicación interactiva | C | 100 | `metric-explanations.ts` + pestaña «Metricas explicadas» con valores reales |
| P1-17 | Backtesting de portafolios | P | 60 | `backtestPortfolio` (4 frecuencias de rebalanceo) + ruta + job. **Sin UI** |
| P1-18 | Walk-forward testing | P | 60 | `walkForward` verificado (4 ventanas). **Sin UI** |
| P1-19 | Exposición geográfica/sectorial | P | 60 | `exposure.ts` + ruta (200 con datos) + tests. **Sin UI** |
| P1-20 | Riesgo cambiario | P | 40 | La ruta `exposure` devuelve `currency`; no hay atribución FX ni pantalla |
| P1-21 | Historial de operaciones | P | 55 | `trade-history.ts` + ruta (200, 3 campos) + tests. **Sin UI**; la página de transacciones no lo usa |
| P1-22 | Costos reales | P | 45 | `costs.ts` usado solo por `scenario-engine`; no configurable por el usuario; sin bruto vs neto |
| P1-23 | Centro de notificaciones | P | 50 | Igual que P0-19 |
| P1-24 | Feature flags | C | 100 | `feature-flags.ts` con 10 banderas + tests |

### OLA 3 — Mercado y analítica cuantitativa

| ID | Tarea | Est. | % | Evidencia / Problemas |
|---|---|---|---:|---|
| P1-25 | Página individual de activo | C | 100 | `/market/[symbol]` con info, rendimiento, riesgo y técnico |
| P1-26 | Factor model | C | 100 | `factors.ts`, tabla `factor_returns` con **761 filas**, regresión OLS, R², endpoint, tests con dataset sintético |
| P1-27 | Factor exposure dashboard | C | 100 | `factor-exposure.tsx` en la pestaña Factores, con lenguaje educativo |
| P1-28 | PCA y effective bets | C | 100 | Probe: correlación perfecta → **1**; 3 independientes → **3,0000**; varianza suma 100% |
| P1-29 | Rolling risk metrics | C | 100 | `rollingRiskSeries` + `detectStressPeriods` + gráfico. Servido dentro de `/risk` en vez de `/rolling-risk` (desviación de ruta, no de función) |
| P1-30 | Stress testing histórico | P | 60 | `HISTORICAL_EPISODES` reales, `stress-test`, ruta (200, `src=mixed`), job, cobertura observed/estimated. **Sin panel de portafolio**; solo experimento de laboratorio |
| P1-31 | Optimización Markowitz | D | 70 | Mínima varianza analítica exacta (0,7358 vs 0,7358); frontera monótona, long-only, suma 1. **NO existen `minWeight`, `maxWeight` ni `sectorCaps`**. Ruta es `/optimization`, no `/efficient-frontier` |
| P1-32 | CVaR y Risk Parity | D | 70 | Risk Parity exacto (33,33% ×3). CVaR minimiza de verdad (1,5098% vs 1,6621% equiponderado). **Sin retorno mínimo, sin min/max, sin topes sectoriales** |
| P1-33 | Visualizaciones cuantitativas | C | 100 | `tests/lint/chart-consistency.test.ts` prohíbe colores literales; skeletons y estados vacíos propios |

### OLA 4 — Estrategias y optimización avanzada

| ID | Tarea | Est. | % | Evidencia / Problemas |
|---|---|---|---:|---|
| P2-1 | Strategy Sandbox | C | 100 | **249 barras, 0 discrepancias** contra implementación independiente. Builder sin código, 5 indicadores, 4 operadores, AND/OR, estrategias de ejemplo |
| P2-2 | Optimización robusta | C | 100 | `robust-optimizer.ts` con rangos, comparación y sensibilidad de pesos |
| P2-3 | Black-Litterman | D | 70 | `blackLitterman` completo con `views` y `tau`. **Pero `model-comparison.ts` lo ejecuta sin views** (solo equilibrio) y no hay UI para declararlas |

### OLA 5 — Advisor completo

| ID | Tarea | Est. | % | Evidencia |
|---|---|---|---:|---|
| D1 | Explicabilidad | C | 100 | «¿Por que recibi esta recomendacion?» con horizonte, riesgo, aportación, capital y probabilidad reales — verificado en pantalla |
| D2 | Viabilidad de aportaciones | C | 100 | `advisor-explain.ts:191` compara contra el ingreso mensual |
| D3 | Modo educativo | C | 100 | `advisor-education.ts`; separa «RESULTADO DEL MODELO» de «EXPLICACION EDUCATIVA» |
| D4 | Invertir vs no invertir | C | 100 | `invertirVsAhorrar` — incluye que en P10 invertir puede ser peor que ahorrar |
| D5 | Exportación del plan | C | 100 | Botones «Descargar documento (.md)» y «Descargar datos (.json)» verificados |
| D6 | Loading real | C | 100 | `advisor-progress.ts`; el `setTimeout` artificial fue eliminado; test fija que el tracker no añade tiempo |
| D7 | Incertidumbre | C | 100 | P10/P25/P50/P75/P90 + «Los resultados representan escenarios simulados bajo los supuestos actuales» |
| D8 | Observabilidad del Advisor | C | 100 | `advisor-telemetry.ts` sin datos financieros sensibles |
| D9 | Documentación del motor | C | 100 | `docs/ADVISOR_FINANCIAL_MODEL.md` (532 líneas) + `advisor-documented-example.test.ts` que fija los ejemplos numéricos |

### OLA 6 — Educación

| ID | Tarea | Est. | % | Evidencia |
|---|---|---|---:|---|
| E1 | Laboratorio académico | C | 100 | **14 experimentos** (los 12 pedidos + riesgo/rendimiento + asimetría), cada uno con objetivo, concepto, parámetros, simulación, resultado e interpretación. Matemática verificada: 10 activos al 20% con ρ=0,2 → 10,58% (teórico 10,58%), piso 8,9% |
| E2 | Comparación de escenarios | C | 100 | `scenario-comparison.ts` + pestaña Escenarios, mismos shocks |
| E3 | Explicación matemática | C | 100 | Pestaña «Metricas explicadas» con las 14 métricas pedidas |

### OLA 7 — Arquitectura y calidad

| ID | Tarea | Est. | % | Evidencia / Problemas |
|---|---|---|---:|---|
| C1 | Background jobs | D | 80 | **42 jobs, todos `completed`, ninguno atascado**. `useJob` con polling y `fallbackUrl`. Pero solo `monteCarlo`, `factors` y `optimization` se disparan; los kinds `backtest` y `stress` existen y nadie los usa |
| C2 | Streaming de precios | C | 100 | Realtime sobre `current_prices` con filtro por símbolo; reconexión; heartbeat degradado |
| C3 | Performance | C | 100 | `lazy-charts.tsx`, `web_vitals` con **328 filas**, `docs/PERFORMANCE_AUDIT.md` |
| C4 | PWA | P | 70 | `public/sw.js`, manifest, banner offline, 2 archivos de test. **Instalación en Android/iOS no ejecutada**; `scripts/pwa-check.mjs` exige build de producción en :3100 |
| C5 | Accesibilidad | C | 100 | `docs/ACCESSIBILITY_AUDIT.md`; todo gráfico tiene `ChartFigure` con resumen y tabla («Ver datos como tabla» verificado) |
| C6 | Seguridad OWASP | C | 100 | **RLS en 33/33 tablas**; CSP con nonce; `tests/lib/security/*`; `docs/SECURITY_AUDIT.md` (380 líneas) |
| C7 | Dependency security | C | 100 | CI ejecuta `npm audit --audit-level=high`; `dependabot.yml` presente |
| C8 | Load testing | C | 100 | `scripts/load-test.mjs` + `docs/LOAD_TEST_RESULTS.md` |
| C9 | UX financiera | C | 100 | `docs/FINANCIAL_UX_AUDIT.md`; `change-tone.test.ts` evita colorear el cero como ganancia |
| D10 | Identidad visual | C | 100 | Tokens semánticos gain/loss/good/bad conservados |
| D11 | Tipografía financiera | C | 100 | `@utility font-financial` + `tests/lint/financial-typography.test.ts` (AST) |
| D12 | Visualizaciones consistentes | C | 100 | `tests/lint/chart-consistency.test.ts` |

### OLA 8 — Arquitectura final del portafolio

| ID | Tarea | Est. | % | Evidencia / Problemas |
|---|---|---|---:|---|
| P2-4 | Atribución temporal | C | 100 | `temporal-attribution.ts` + componente; enlace de Carino |
| P2-5 | Riesgo factorial avanzado | C | 100 | `risk-sources.ts`: activo, sector, factor, componente principal y mercado; cada vista suma 100% |
| P2-6 | Optimización multimodelo | C | 100 | 5 modelos comparados con la misma regla; no declara ganador |
| P2-7 | Portfolio Health | C | 100 | 9 componentes; en este portafolio 7 medidos y **2 declarados «Sin datos» honestamente** |
| P2-8 | Portfolio Diagnostic | D | 85 | Las 9 preguntas respondidas. **Defecto:** su «peor drawdown» (8,2%) no coincide con el de la ruta risk (8,72%) ni con el de Health (8,7%), y usan fechas distintas |
| P2-9 | Scenario Engine | D | 70 | `scenario-engine.ts` reproducible y con `_meta`. **Advisor, Laboratorio, Rebalanceo y Backtesting NO fueron migrados**: la tarea pide que sea reutilizable por los seis |
| P2-10 | Auditabilidad completa | C | 100 | **Las 19 rutas verificadas una por una** devuelven `_meta` con modelo@versión, `cache.served` y `data.priceSource` |

---

## 5. AUDITORÍA CRÍTICA P0-21 — PRUEBA REAL EJECUTADA

**Resultado: NO existe recomendación circular. NO es CRÍTICO.**

### A nivel de motor

```
P0-21 current=1000 prob=8.45% target=75% recommended=2042.93
P0-21 second pass: prob=75.00% recommendedAgain=2042.93
P0-21 goal already reached → 0
P0-21 unreachable goal → null
P0-21 monotonicity in contribution: OK
```

### A nivel de interfaz (navegador, sesión real, servidor de desarrollo)

Perfil Moderado, 30 años, ingreso 30.000, horizonte 10 años, capital 100.000, meta 1.000.000.

| Ejecución | Aportación introducida | Probabilidad | Mensaje de la app | Recomendación |
|---|---:|---:|---|---:|
| 1ª | $1.000 | 0,0% | «la meta es improbable» | **$5.810** |
| 2ª | **$5.810** | **75,8%** | **«Ya es suficiente para el objetivo de confianza: no necesitas aportar mas»** | $5.763 |

La segunda recomendación es **menor** que la aportación actual y la app lo dice
explícitamente en lugar de volver a pedir más.

**Por qué funciona (`src/lib/services/advisor.ts:417-450`):** la bisección se resuelve contra
el **mismo** `ScenarioSet` con el que después se mide la probabilidad, `probabilityAt(0) >=
objetivo → return 0`, y el bracket se expande hasta `MAX_SEARCH_CONTRIBUTION` devolviendo
`null` si la meta es inalcanzable.

**Defecto relacionado (P0-23, no crítico):** la semilla incluye la aportación, así que las dos
ejecuciones de la tabla usan universos distintos ($5.810 vs $5.763). Eso no reintroduce la
circularidad —dentro de cada ejecución todo es consistente— pero incumple el
«common random numbers» que P0-23 pide para comparar $1.000 contra $2.000.

---

## 6. AUDITORÍA MATEMÁTICA Y FINANCIERA

### Verificado correcto

| Concepto | Prueba | Resultado |
|---|---|---|
| Volatilidad | denominador n−1, ×√252 | correcto |
| Sharpe | (μ·252 − Rf)/σ anual, con piso antipolvo de coma flotante | correcto |
| Sortino | objetivo 0, denominador = n total | correcto y consistente |
| Beta/Alpha | Cov(Rp,Rb)/Var(Rb) | 1 / 2 / −1 exactos |
| Covarianza | simétrica, varianza muestral en la diagonal | correcto |
| Volatilidad de portafolio | σ/√N para N idénticos no correlacionados | correcto |
| Contribución al riesgo | identidad de Euler: suma = σp | correcto |
| Drawdown | caída desde máximo móvil | correcto |
| Asimetría de recuperación | −23% → +29,9% | exacto |
| TWR vs XIRR | 100,0000% vs 17,1124% | correctamente distintos |
| VaR histórico y paramétrico | 1,6449σ al 95% | correcto |
| Cornish-Fisher | skew + exceso de curtosis | correcto |
| PCA / effective bets | 1 y 3,0000 | correcto |
| Markowitz mínima varianza | 0,7358 vs analítico 0,7358 | correcto |
| Risk Parity | 33,33% ×3 | correcto |
| CVaR mínimo | 1,5098% < 1,6621% equiponderado | correcto |
| GBM correlacionado | diversificación visible, reproducible | correcto |
| Split 4:1 | historia reexpresada | correcto |
| Precisión monetaria | reparto sin perder un centavo | correcto |

### Duplicación de lógica (incumple la regla 2 del roadmap)

| Concepto | Implementación canónica | Copia | Consecuencia |
|---|---|---|---|
| Sharpe | `analytics.ts:25` | `snapshots.ts:456` (inline) | Numéricamente idéntico, pero es una segunda copia |
| Sortino | `asset-metrics.ts:279` | `snapshots.ts:461` + `downsideDev:162` | Idéntico, segunda copia |
| Rebalanceo | `rebalance.ts` (huérfano) | `portfolio-diagnostic.ts:301` | El módulo dedicado no se usa y el concepto se reimplementó |
| Frescura | `freshness.ts` (huérfano) | `allocation/route.ts:61` y `portfolio.ts:124` | Tres definiciones distintas de «desactualizado» |
| Días hábiles | — | **`TRADING_DAYS = 252` en 19 archivos** | Valores iguales hoy; un cambio exige 19 ediciones |

Los 19 archivos: `jobs/kinds/{monte-carlo,optimization,risk-inputs}.ts`,
`services/{allocation-strategies,analytics,asset-compare,asset-metrics,backtest,discover,factors,lab,metric-explanations,model-comparison,monte-carlo,optimizer,rolling-metrics,scenario-comparison,snapshots}.ts`.
Además `analytics.ts` escribe `252` literal en las líneas 12 y 28 teniendo `TRADING_DAYS`
declarado en la línea 54 del mismo archivo.

### Unidades y convenciones

Las tasas son fracciones anuales (`0.03788` = 3,788%) de forma consistente entre
`risk-free-rate.ts` y `analytics.ts`. Las volatilidades se anualizan siempre con √252 desde
barras diarias, y `asset-metrics.ts:374` documenta explícitamente el reescalado
`√(periodsPerYear/252)` para cadencias distintas en vez de reimplementar. **No se encontró
ninguna confusión 0.07 vs 7%.**

### Problema de moneda (no resuelto)

El gráfico de valor del portafolio suma cierres de proveedor **sin convertir de divisa**, y
la interfaz muestra pesos. En el portafolio auditado el encabezado dice `$46.325,41 MXN` y
el último punto del gráfico vale `2.702,14` — la misma cifra dividida por el tipo de cambio
(17,144). Convertir bien exige la moneda **de cotización** por símbolo: `price_history` no
tiene columna de moneda, y `positions.currency` es la moneda en que se registró el **costo**
(hay filas de AAPL, VOO y NVDA marcadas MXN y FEMSAUBD.MX marcada USD), así que no sirve
para esto.

---

## 7. AUDITORÍA DE MONTE CARLO (portafolio y Advisor)

**No están mezclados.** Son dos motores distintos, como pide el roadmap:

| | Portafolio (P0-1) | Advisor (P0-23) |
|---|---|---|
| Archivo | `monte-carlo.ts` | `advisor.ts` |
| Entrada | retornos históricos reales de los activos | rendimiento y volatilidad supuestos del perfil |
| Correlación | Cholesky sobre la covarianza | no aplica (una sola serie) |
| Shocks | `forEachCorrelatedStep` | `buildScenarios` (mulberry32) |
| Semilla | parámetro `seed` | derivada del plan |

Verificado en el Advisor: P10 253.258 < P25 296.626 < mediana 352.046 < P75 413.465 < P90
490.485; `MIN_ANNUAL_RETURN = -0.99` impide rendimientos ≤ −100%; la mediana simulada
(352.046) es menor que la proyección determinista (367.767) y **la app explica por qué**
(volatility drag). 1.000 trayectorias declaradas en pantalla.

**Nota sobre `choleskyDecomposition` y matrices singulares:** en la primera pasada se anotó
como «detalle menor» que devuelve una matriz en vez de `null`. **Esa observación era
incorrecta y queda retirada** — ver §23.

---

## 8. AUDITORÍA DE FRONTEND (pantallas reales, sesión iniciada)

Recorridas: Dashboard, Portafolios, Analytics (8 pestañas), Advisor (flujo completo de 4
pasos + resultado), Laboratorio, Mercados, Comparar, Alertas, Watchlist, Descubrir,
Ranking, Configuración.

**Sin NaN, sin Infinity, sin `undefined`, sin `$undefined`, sin `[object Object]`** en ninguna
de las 8 pestañas de Analytics ni en el resultado del Advisor (barrido programático del
`innerText`).

Todas las páginas responden 200 excepto `/admin/metrics` → **404 por diseño** (no es admin).

### Defectos encontrados en pantalla

| # | Defecto | Archivo | Severidad |
|---|---|---|---|
| F1 | «Por Sector» dibuja tres barras **sin etiqueta**: la API devuelve `bySector[].name` y la página lee `s.sector` | `src/app/(app)/portfolio/[id]/analytics/page.tsx:274-276` | P1 |
| F2 | 8 pestañas dentro de `grid-cols-5`: envuelven en dos filas desalineadas | `…/analytics/page.tsx:67` | P3 |
| F3 | Tres cifras distintas para «la peor caída» en la misma pantalla | ver §9 | P2 |
| F4 | La miga de pan muestra el UUID crudo en vez del nombre del portafolio | `…/analytics/page.tsx` | P3 |
| F5 | El gráfico va en dólares y el encabezado en pesos, sin etiqueta de moneda | `portfolio-chart.tsx` | P1 |
| F6 | Tras un análisis del Advisor solo existe «Volver a empezar»: para cambiar la aportación hay que repetir los 4 pasos | `advisor/page.tsx` | P3 |

`recharts_measurement_span` con `$0.00 MXN` aparece bajo `<body>`: es un elemento interno de
Recharts, `aria-hidden`, posicionado a −20000px. **No es un defecto.**

---

## 9. CONSISTENCIA UI vs MOTOR

Comparadas las cifras de pantalla con las del motor para: valor de portafolio, P&L, retorno
simple, TWR, MWR, volatilidad, Sharpe, Beta, VaR, CVaR, drawdown, probabilidad, valor
esperado, contribuciones y salud. **Coinciden en todos los casos salvo uno.**

### La excepción: «peor caída»

| Origen | Valor | Ventana | Definición |
|---|---:|---|---|
| `/api/analytics/[pid]/risk` → `drawdown_analysis.max_pct` | **8,720%** | máximo el 2026-07-29 | serie de valor |
| `/api/analytics/[pid]/diagnostic` | **8,2%** | 2026-06-02 → 2026-06-25 | índice TWR |
| `/api/analytics/[pid]/health` (componente «Caídas», 49/100) | **8,7%** | periodo del riesgo | reprecio con pesos actuales |

Las tres son metodológicamente defendibles. El defecto es que **las tres se presentan al
lector como «la peor caída» sin decir que miden cosas distintas**, en la misma pantalla.

---

## 10. SEGURIDAD

| Control | Estado | Evidencia |
|---|---|---|
| RLS | ✅ | **33 de 33** tablas públicas con RLS activo |
| Tablas de observabilidad | ✅ | `error_events`, `funnel_events`, `web_vitals`: RLS sin políticas = deny-all, solo service role |
| Aislamiento entre usuarios | ✅ | `portfolios`, `positions`, `transactions`, `goals` con 4 políticas cada una |
| Secretos en cliente | ✅ | Solo `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` (públicas por diseño) |
| `.env.local` | ✅ | Ignorado por `.gitignore:37` |
| Claves de proveedor | ✅ | Twelve Data, Alpha Vantage y `SUPABASE_SERVICE_ROLE_KEY` solo en servidor |
| CRON_SECRET | ✅ | Presente; `tests/lib/api/cron-auth.test.ts` fija el fail-closed |
| CSP | ✅ | Nonce; `tests/lib/security/csp.test.ts` |
| Inyección / XSS | ✅ | `tests/lib/security/inputs.test.ts`; PostgREST parametrizado |
| Caché por usuario | ✅ | `tests/lib/cache/cache-key-scope.test.ts` fija el alcance |
| Rate limiting | ✅ | 600/dirección, 300/usuario, 60/anónimo |
| Panel admin | ✅ | 404 en vez de 403 para no anunciar que existe |

**No se encontró ninguna vía para leer o modificar datos de otro usuario.**

Advertencia no relacionada con el código: el repositorio es **público** y algunos mensajes de
commit anteriores contienen cifras del portafolio del propietario.

---

## 11. JOBS, REALTIME, PWA, PERFORMANCE, ACCESIBILIDAD

**Jobs (C1):** 42 registros, **todos `completed`**. Ninguno atascado en `processing`. Hay
`timeout`, `retry`, `attempts`/`max_attempts`, `error_kind` y un `fallbackUrl` síncrono si el
entorno no soporta jobs. Falta cablear los kinds `backtest` y `stress`.

**Realtime (C2):** suscripción a `current_prices` filtrada por símbolo (no hay stream global),
limpieza de listeners, heartbeat de 5 min con canal activo y 60 s si cae.
*Observación:* varias posiciones tenían cotización de hace más de un día mientras AAPL, MSFT
y VOO se refrescaban cada minuto. No diagnosticado.

**PWA (C4):** service worker, manifest, iconos, banner offline y 2 archivos de test.
`scripts/pwa-check.mjs` exige un build de producción en :3100 — **no ejecutable** con el
servidor de desarrollo activo. Las verificaciones de instalación en Android/iOS que el
propio `docs/PWA_TESTING.md` lista **siguen sin ejecutarse**.

**Performance (C3):** Recharts cargado dinámicamente (`lazy-charts.tsx`), `web_vitals` con
328 mediciones reales. Cuello de botella observado: la pestaña General dispara ~6 peticiones
de analytics en paralelo y tarda ~20 s en pintar del todo en desarrollo.

**Accesibilidad (C5):** todo gráfico envuelto en `ChartFigure` con resumen textual y tabla
(«Ver datos como tabla» presente en cada uno). Roles de pestaña correctos, `aria-pressed` en
los selectores de periodo, enlace «Saltar al contenido». La inyección de axe está bloqueada
por la CSP con nonce, así que la verificación automática WCAG completa **no es ejecutable**.

---

## 12. AUDITORÍA DE TESTS

**Ejecutados y resultados exactos en §22.**

**Lo que los tests cubren bien:** los servicios financieros (70 archivos), la suite de
regresión con valores golden, y cinco tests de lint por AST/regex que fijan invariantes
estructurales (tipografía financiera, colores de gráfico, orden de replay de transacciones,
columnas de portafolio, metadata de resultados).

**Lo que NO cubren:**

1. **Rutas API.** No hay un solo test de handler. Los defectos de contrato API↔UI (Ingresos
   la semana pasada, «Por Sector» ahora) pasan porque nada prueba la forma que devuelve la
   ruta contra la que lee la página.
2. **Los 9 flujos autenticados E2E** están omitidos: se saltan sin `E2E_EMAIL`/`E2E_PASSWORD`.
3. **Integración endpoint→UI.** Ningún test detecta que 11 rutas no tengan consumidor.
4. **Componentes:** solo 7 archivos, todos de OLA 8. No hay tests de la página de analytics,
   del dashboard ni del Advisor.

**Tests que pasan sin probar lo importante:** `tests/lib/services/goals.test.ts`,
`rebalance.test.ts`, `what-if.test.ts` y `freshness.test.ts` prueban lógica que la aplicación
**nunca ejecuta**. Pasan, y aun así esas funcionalidades no llegan al usuario.

---

## 13. PROPERTY TESTING — las 10 propiedades pedidas

| # | Propiedad | Resultado |
|---|---|---|
| 1 | Mayor aportación → no menor valor esperado | ✅ verificado |
| 2 | Mayor horizonte con retorno positivo → no menor valor futuro | ✅ verificado |
| 3 | Meta menor → no mayor aportación necesaria | ✅ (monotonía de la bisección) |
| 4 | Aportación que cumple ≥ la que no cumple | ✅ verificado |
| 5 | Pesos suman 1 | ✅ en los 39 puntos de la frontera y en los 5 modelos |
| 6 | Probabilidades entre 0 y 1 | ✅ verificado |
| 7 | Valores monetarios finitos | ✅ verificado |
| 8 | Semilla fija → resultado reproducible | ✅ distribución byte-idéntica |
| 9 | Escenarios comunes → shocks equivalentes | ⚠️ **dentro** de una ejecución sí; **entre** ejecuciones no (P0-23) |
| 10 | Resultados monótonos donde corresponde | ✅ verificado |

---

## 14. REGRESIONES

**No se detectó ninguna regresión.** Autenticación, registro, login, creación de portafolio,
alta y baja de activos, dashboard, posiciones, P&L, mercado, watchlist, riesgo, benchmark,
advisor, backtesting y laboratorio responden. Las 10 pruebas E2E públicas pasan.

Único incidente registrado en `error_events` con fecha de hoy
(`/api/portfolio/history — "current is not defined"`, 2026-09-15 23:57) fue un artefacto
transitorio de HMR **durante la edición de esta misma sesión**, no de código publicado. El
build y la suite posteriores están limpios.

Los 47 errores de `/api/discover/portfolios` («Could not find the function
`public.get_public_portfolios`») son del **14 de septiembre**, anteriores a la corrección de
la capa social. Hoy la ruta devuelve 200.

---

## 15. DOCUMENTACIÓN

| Documento pedido | Estado | Nota |
|---|---|---|
| `FINANCIAL_ASSUMPTIONS.md` | ✅ 304 líneas | Registro con nombre, valor, unidad, fuente, fecha y módulo |
| `ADVISOR_FINANCIAL_MODEL.md` | ✅ 532 líneas | Los 16 puntos; test que fija los ejemplos numéricos |
| `DATA_QUALITY.md` | ✅ 148 líneas | Corresponde a `data-quality.ts` |
| `SECURITY_AUDIT.md` | ✅ 380 líneas | Con categoría, evidencia, riesgo, severidad y solución |
| `ACCESSIBILITY_AUDIT.md` | ✅ 270 líneas | |
| `PERFORMANCE_AUDIT.md` | ✅ 226 líneas | Antes/después |
| `PWA_TESTING.md` | ✅ 174 líneas | **Declara pendientes las pruebas en dispositivo** |
| `LOAD_TEST_RESULTS.md` | ✅ 237 líneas | |
| `TESTING.md` | ⚠️ | Existe `E2E_TESTING.md` (99 líneas), no `TESTING.md` |
| `BACKTESTING_RESULTS.md` | ⚠️ | Existe `BACKTEST_RESULTS.md` (104 líneas) |
| `ADVISOR_MODEL_VERSIONING.md` | ✅ 153 líneas | P0-28 |
| `RESULT_METADATA.md` | ✅ 48 líneas | P2-10 |

**Desactualización encontrada:** `docs/RESULT_METADATA.md` describe el diseño correctamente,
pero ningún documento menciona que 11 endpoints carecen de interfaz ni que cuatro servicios
están huérfanos.

---

## 16. LISTA DE PROBLEMAS

### P0 — CRÍTICO

**Ninguno.** No se encontró ninguna fórmula incorrecta, look-ahead bias, recomendación
circular, fuga de datos entre usuarios, probabilidad inválida ni peso inválido.

### P1 — ALTO

| # | Tarea | Problema | Archivo/línea | Impacto | Solución recomendada |
|---|---|---|---|---|---|
| A1 | P1-31 | `optimiseWeights(cov, expectedReturns, aversion)` y `efficientFrontier(symbols, cov, expectedReturns, {riskFreeRate, currentWeights, points})` no aceptan `minWeight`, `maxWeight` ni `sectorCaps`. Un solve sin restricción entrega 100% en un activo | `src/lib/services/optimizer.ts:108,323` | La frontera puede recomendar carteras imposibles de sostener; la tarea lista las restricciones como entrada obligatoria | Añadir proyección con cotas: reemplazar `projectOntoSimplex` por una proyección sobre la cápsula `{w: Σw=1, lᵢ≤wᵢ≤uᵢ}` y aplicar topes sectoriales como restricciones de grupo |
| A2 | P1-32 | `minimiseCVaRWeights(returnsMatrix, confidence)` no acepta retorno mínimo, min/max ni topes sectoriales | `src/lib/services/allocation-strategies.ts:175` | «Minimizar CVaR sujeto a retorno mínimo» es la formulación pedida; hoy es minimización libre | Añadir el retorno mínimo como penalización o proyección en el descenso subgradiente |
| A3 | P1-8, P1-9 | Metas con tabla, RLS, API, servicio y tests, y **sin ninguna pantalla**. `goals` y `goal_projections` tienen 0 filas. El Advisor calcula la meta en memoria y nunca la persiste | `src/app/api/goals/*`, `src/lib/services/goals.ts` | Dos tareas completas del roadmap son inalcanzables para el usuario | Página `/goals` + guardar la proyección del Advisor al terminar |
| A4 | P0-12, P1-10 | `rebalance.ts` (430 líneas: desviación, bandas, calendario, deriva de riesgo, simulación antes/después) no lo importa nadie | `src/lib/services/rebalance.ts` | Dos tareas sin acceso; además el diagnóstico reimplementa el concepto en `portfolio-diagnostic.ts:301` | Panel de rebalanceo en la pestaña de Asignación, consumiendo el módulo existente |
| A5 | P1-17, P1-18, P1-19, P1-30 | Backtesting de portafolio, walk-forward, exposición geo/sectorial y stress testing tienen motor + endpoint (200 con datos) + tests y **ninguna interfaz** | `src/app/api/analytics/[pid]/{backtest,exposure,stress}` | Cuatro tareas de OLA 2 y 3 invisibles | Pestañas nuevas en Analytics, o tarjetas en las existentes |
| A6 | — | Defecto de contrato: la ruta devuelve `bySector[].name`, la página lee `s.sector` → tres barras sin etiqueta y `key={undefined}` repetida | `src/app/(app)/portfolio/[id]/analytics/page.tsx:274-276` | El usuario ve porcentajes sin saber de qué sector | Leer `s.name`; añadir un test de contrato ruta↔página |
| A7 | — | El gráfico de valor suma cierres sin convertir divisa y la interfaz muestra pesos: encabezado `$46.325,41 MXN` vs último punto `2.702,14` | `src/app/api/portfolio/history/route.ts`, `portfolio-chart.tsx` | Dos cifras del mismo número con 17× de diferencia en la misma pantalla | Guardar la moneda de cotización en `price_history` (migración) y convertir en origen |
| A8 | P0-14 | Benchmark no configurable ni persistido: no hay columna en `portfolios` ni selector; todo usa `'SPY'` | `src/app/api/analytics/[pid]/benchmark/route.ts:14` | La tarea pide elegir y **guardar** el benchmark | Columna `benchmark_symbol` + selector en ajustes del portafolio |
| A9 | P1-3 | 9 de 19 pruebas E2E se omiten por falta de `E2E_EMAIL`/`E2E_PASSWORD` | `e2e/authenticated.spec.ts` | Los flujos autenticados nunca se prueban automáticamente | Crear un usuario de prueba dedicado y ponerlo en los secretos de CI |

### P2 — MEDIO

| # | Tarea | Problema | Archivo/línea | Solución |
|---|---|---|---|---|
| B1 | P0-23 | La semilla incluye la aportación y el horizonte: comparar $1.000 vs $2.000 usa shocks distintos | `src/app/(app)/advisor/page.tsx:424` | Derivar la semilla solo del perfil y la meta |
| B2 | P2-8 | Tres cifras de «peor caída» (8,72 / 8,2 / 8,7) con dos rangos de fecha en la misma pantalla | §9 | Nombrar cada una por su método, o unificarlas |
| B3 | P0-20 | `TRADING_DAYS = 252` duplicado en 19 archivos; `analytics.ts` lo escribe literal en las líneas 12 y 28 teniendo la constante en la 54 | 19 archivos | Exportarla desde un único módulo de supuestos |
| B4 | P0-9 | `freshness.ts` (live/delayed/cached/unavailable) huérfano; la UI usa dos banderas binarias distintas | `allocation/route.ts:61`, `portfolio.ts:124` | Consumir `classifyFreshness` en ambos sitios |
| B5 | P0-16, P0-19 | Audit trail y notificaciones con API y tabla, 0 filas y sin UI | `/api/audit`, `/api/notifications` | Registrar los eventos y añadir la bandeja |
| B6 | P2-9 | Advisor, Laboratorio, Rebalanceo y Backtesting no migrados al motor de escenarios | `scenario-engine.ts` | Migrar, subiendo la versión de modelo donde cambien cifras |
| B7 | P2-3 | Black-Litterman se ejecuta sin views en la comparación de modelos | `model-comparison.ts` | UI para declarar views y su confianza |
| B8 | C1 | Los kinds `backtest` y `stress` existen y nadie los dispara | `src/lib/jobs/kinds/` | Cablearlos cuando exista su UI (A5) |
| B9 | P1-5, P1-15, P1-21, P1-22 | Comparador de estrategias, ¿qué pasaría si?, historial de operaciones y costos configurables: lógica lista, sin interfaz | varios | Exponerlos |
| B10 | — | `current_prices` con cotizaciones de más de un día para varias posiciones mientras otras se refrescan cada minuto | no diagnosticado | Investigar el filtro de `changedRows`/`getBatchQuotes` |
| B11 | — | No existe ningún test de handler de API | `tests/` | Tests de contrato para las 19 rutas de analytics |

### P3 — BAJO

| # | Problema | Archivo |
|---|---|---|
| C1 | 8 pestañas en `grid-cols-5`: envuelven desalineadas | `analytics/page.tsx:67` |
| C2 | Miga de pan con el UUID crudo en vez del nombre | `analytics/page.tsx` |
| C3 | Tras un análisis solo hay «Volver a empezar»: cambiar la aportación exige repetir 4 pasos | `advisor/page.tsx` |
| C4 | 45 warnings de eslint (variables sin usar, un `eslint-disable` innecesario) | varios |
| C5 | `TESTING.md` y `BACKTESTING_RESULTS.md` con nombres distintos a los pedidos | `docs/` |
| ~~C6~~ | ~~`choleskyDecomposition` devuelve matriz en vez de `null` para covarianza singular~~ **RETIRADO — ver §23** | `covariance.ts:65` |
| C7 | Rutas con nombre distinto al de la especificación: `/optimization` en vez de `/efficient-frontier`, rolling risk dentro de `/risk` | `src/app/api/analytics/` |
| C8 | `funnel_events` con solo 2 filas: los eventos del embudo casi no se emiten | `lib/analytics/events.ts` |

---

## 17. TOP 10 — LO QUE DEBE CORREGIRSE ANTES DE DAR POR TERMINADO

Ordenado por corrección financiera → seguridad → integridad de datos → funcionalidad →
regresiones → performance → UX.

| # | Problema | Por qué está aquí |
|---|---|---|
| 1 | **Markowitz sin min/max/topes sectoriales** (A1) | Corrección financiera: la optimización puede proponer carteras que violan las restricciones que la tarea declara obligatorias |
| 2 | **CVaR sin restricción de retorno mínimo** (A2) | Corrección financiera: no es la formulación pedida |
| 3 | **El gráfico en dólares y la página en pesos** (A7) | Integridad de datos: dos cifras del mismo número, 17× de diferencia, sin etiqueta |
| 4 | **«Por Sector» sin etiquetas por desajuste de contrato** (A6) | Integridad de datos: la UI no representa lo que devuelve el motor. Es el segundo caso de la misma clase en una semana |
| 5 | **Metas sin interfaz** (A3) | Funcionalidad: dos tareas completas e inalcanzables; nada se persiste |
| 6 | **Rebalanceo huérfano** (A4) | Funcionalidad: dos tareas más inalcanzables, con el concepto reimplementado aparte |
| 7 | **Backtesting de portafolio, walk-forward, exposición y stress sin UI** (A5) | Funcionalidad: cuatro tareas invisibles |
| 8 | **Tres cifras para «la peor caída»** (B2) | UX financiera: contradicción aparente en la misma pantalla |
| 9 | **Common random numbers entre ejecuciones** (B1) | Corrección financiera menor: incumple el requisito explícito de P0-23 |
| 10 | **9 pruebas E2E autenticadas omitidas + cero tests de API** (A9, B11) | Regresiones: los dos defectos de contrato de esta semana habrían sido detectados por un test de ruta |

---

## 18. VEREDICTO FINAL

# 🟡 CASI LISTO — REQUIERE CORRECCIONES

**Por qué no es 🔴:** el motor financiero es correcto y está verificado, no a partir de que
los tests pasen, sino con pruebas independientes contra propiedades matemáticas conocidas.
PCA da 1 y 3. Risk Parity iguala el riesgo al tercer decimal. Markowitz reproduce la
solución analítica. El backtesting no mira el futuro. El sandbox ejecuta la regla del
usuario, no una fija. La recomendación circular está muerta, comprobado en la interfaz. RLS
está en las 33 tablas. No hay NaN ni Infinity en ninguna pantalla. Los 42 jobs cerraron.
Las 19 rutas de analytics dicen de dónde salen sus números.

**Por qué no es 🟢:** dos problemas reales.

El primero es de **optimización**: Markowitz y CVaR no implementan las restricciones que sus
tareas declaran como entrada obligatoria. Eso no es un detalle de interfaz; es la diferencia
entre una frontera eficiente utilizable y una que puede sugerir el 100% en un activo.

El segundo es de **integración**, y es el más grande en volumen: hay al menos diez tareas
cuyo motor está terminado, probado y funcionando —responden 200 con datos reales— y que la
aplicación nunca muestra. Metas, rebalanceo, backtesting de portafolio, walk-forward,
exposición geográfica y sectorial, stress testing, historial de operaciones, notificaciones,
audit trail, calidad de datos, ¿qué pasaría si? El criterio 4 del propio roadmap dice que
una tarea no está terminada si la UI no la utiliza cuando corresponde. Por ese criterio, no
lo están.

Hay también un patrón que conviene nombrar: **dos defectos de contrato API↔UI en una semana**
(pestaña Ingresos, «Por Sector»), ambos del mismo tipo, ambos invisibles para 2.081 tests
porque ninguno prueba una ruta contra su página. Mientras no exista esa capa de tests, va a
volver a pasar.

Nada de esto pone en duda las cifras que el sistema muestra hoy. Pone en duda que todo lo
construido esté llegando al usuario.

---

## 19. QUÉ COMANDOS SE EJECUTARON Y QUÉ DEVOLVIÓ CADA UNO

| Comando | Resultado |
|---|---|
| `npm run test:run` | **111 archivos, 2.081 tests, todos pasan.** 17,8 s |
| `npx tsc --noEmit` | **Sin errores.** Código de salida 0 |
| `npm run build` | **Compilado correctamente en 2,7 s.** Código 0 |
| `npm run lint` | **0 errores, 45 warnings.** Código 0 |
| `npx playwright test` | Falla al arrancar: «Another next dev server is already running» (config usa :3100, hay uno en :3000) |
| `E2E_BASE_URL=http://localhost:3000 npx playwright test` | **10 pasan, 9 omitidos** (5,3 s). Los 9 son los autenticados |
| `npm run test:financial` | Incluido en la corrida completa: `tests/financial-regression/golden.test.ts`, 406 líneas |
| `node scripts/pwa-check.mjs http://localhost:3000` | **Sin resultado**: exige build de producción; se agotó el tiempo |
| `npx vitest run --config <scratchpad>/vitest.audit.config.ts` | **10 de 10 pruebas de auditoría pasan** (escritas fuera del repositorio) |
| Consultas SQL de solo lectura (Supabase) | RLS, filas por tabla, `cron_runs`, `analytics_jobs`, `error_events`, políticas |
| Navegador con sesión iniciada | Dashboard, Portafolios, Analytics ×8 pestañas, Advisor (flujo completo ×2), Laboratorio, y 9 páginas más |
| 19 llamadas a `/api/analytics/[pid]/*` | **Las 19 responden 200 con `_meta`** |

### Salida íntegra de las pruebas de auditoría

```
P0-21 current=1000 prob=8.45% target=75% recommended=2042.93
P0-21 second pass: prob=75.00% recommendedAgain=2042.93
P0-21 goal already reached → 0
P0-21 unreachable goal → null
P0-21 monotonicity in contribution: OK
P0-26 properties: monotone, ordered, finite, reproducible — OK
P1-31 min-variance analytic w1=0.7358 solver w1=0.7358
P1-31 frontier points=39, weights sum to 1, long-only, monotone — OK
P1-31 SPEC GAP: no minWeight/maxWeight/sectorCap parameter exists. Unconstrained solve gives max weight 100.0%
P1-32 risk-parity contributions: 33.33% 33.33% 33.33%
P1-32 minCVaR=1.5098% vs equal-weight=1.6621% weights=55.6/30.5/13.9
P1-32 SPEC GAP: minimiseCVaRWeights(returnsMatrix, confidence) takes no minimum-return, min/max weight or sector-cap argument.
P1-28 perfectly correlated → 1 ; independent (n=3) → 2.9999999999999996
P1-28 variance explained sums to 100.0000%
P0-1 final band width: single=0.5634 perfectly-correlated-pair=0.6132 negatively-correlated-pair=0.0744
P0-1 reproducible, all paths > 0 (no return below -100%), percentiles ordered — OK
P0-1 cholesky on a singular (perfectly correlated) matrix → matrix returned
P1-1 trades in prefix(250 bars)=3, same-window trades in full(400 bars)=3
P1-1 every entry date from the truncated run reappears in the full run — no look-ahead
P1-1/P1-18 walkForward windows=4
P2-1 checked 249 bars against an independent SMA20/SMA50 cross implementation: 3 buys, 2 sells, 0 mismatches
P2-1 runStrategy: buyRule="Media movil simple (SMA) de 20 cruza por encima de Media movil simple (SMA) de 50." trades=3 vsBuyHold=2.94pp
P0-13 TWR=100.0000% XIRR=17.1124%
```

---

## 20. ESTADO DE LOS DATOS EN PRODUCCIÓN

| Tabla | Filas | Lectura |
|---|---:|---|
| `portfolio_snapshots` | **0** | El cron nocturno nunca escribió. Bloquea ranking, seguimiento de metas y el tramo de snapshots del gráfico |
| `goals` / `goal_projections` | **0** / **0** | Sin interfaz que las cree |
| `notifications` | **0** | Nunca se emiten |
| `audit_log` | **0** | Nunca se registra |
| `leaderboard_cache` | **0** | Depende de los snapshots |
| `factor_returns` | 761 | Reconstruida y al día |
| `web_vitals` | 328 | C3 midiendo de verdad |
| `error_events` | 63 | P0-4 capturando de verdad |
| `funnel_events` | **2** | Los eventos del embudo casi no se emiten |
| `analytics_jobs` | 42 | **Todos `completed`** |

### `cron_runs`

| Job | Última ejecución | Estado |
|---|---|---|
| `daily_baselines` | 2026-09-15 15:13 | **`partial`, cerrado** (107 procesados / 7 fallidos, 3.049 ms) |
| `nightly_snapshots` | 2026-09-15 01:31 | **`running`, sin cerrar**, 0 procesados |

Las noches del 12, 13 y 14 quedaron igual. La corrección de `finishCronRun` se publicó el 15
durante el día y `daily_baselines` ya cierra bien; la primera ejecución nocturna con el
arreglo sería la del **16 a las 01:00 UTC**, que aún no ha ocurrido. **Conviene verificarla.**

---

## 21. QUÉ NO SE PUDO VERIFICAR, Y POR QUÉ

| Elemento | Motivo |
|---|---|
| Contenido de `/admin/metrics` | `ADMIN_EMAILS` no está configurado; la página devuelve 404 por diseño |
| Instalación PWA en Android/iOS | Requiere dispositivos reales; `docs/PWA_TESTING.md` ya lo declara pendiente |
| `scripts/pwa-check.mjs` | Exige un build de producción en :3100; hay un servidor de desarrollo ocupando el directorio |
| 9 pruebas E2E autenticadas | Requieren `E2E_EMAIL`/`E2E_PASSWORD`. **No se usaron las credenciales del propietario** |
| Auditoría WCAG automática (axe) | La CSP con nonce bloquea la inyección del script |
| Sentry y PostHog en vivo | Sin DSN ni clave en el entorno local |
| Comportamiento del cron nocturno corregido | La primera ejecución con el arreglo aún no ha ocurrido |
| Carga real contra staging | `docs/LOAD_TEST_RESULTS.md` existe; no se repitió (la tarea prohíbe correrla contra producción) |
| Los cuatro documentos de especificación citados | No existen en este entorno (§0) |

---

## 22. NOTA DE MÉTODO

Las diez pruebas de auditoría se escribieron **fuera del repositorio**, en el directorio
temporal de la sesión, con una configuración de vitest propia que apunta a `src/` mediante
el mismo alias `@`. El repositorio no contiene ningún archivo nuevo salvo este documento.

Las consultas a Supabase fueron **exclusivamente de lectura** (`SELECT`), salvo una excepción
declarada: durante el trabajo previo de esta misma sesión —antes de que empezara la
auditoría— se escribieron cierres diarios reales de GOOGL, NVDA, AMZN y NDAQ en
`price_history`, que es la caché compartida de datos de mercado y es aditiva. No se tocó
ningún dato de portafolio.

Los datos del portafolio del propietario se usaron solo para verificar en pantalla. Como el
repositorio es público, este documento evita reproducir cifras de sus posiciones salvo las
estrictamente necesarias para documentar un defecto.

---

## 23. CORRECCIÓN A ESTE DIAGNÓSTICO — Cholesky con matrices singulares

**Añadido el 2026-09-16, durante la ejecución del plan de corrección.**

En la primera pasada anoté como defecto menor (C6) que `choleskyDecomposition` devuelve una
matriz en vez de `null` ante una covarianza singular. **Esa observación era incorrecta.**
La anoté desde la salida de una prueba sin leer la implementación con cuidado, y el plan de
corrección la convirtió en la tarea 1.2 («devuelve `null` si el pivote es menor a 1e-10»).

**Implementarla habría sido una regresión.** La función ya trata el caso, a propósito, en
`src/lib/services/covariance.ts:78`: cuando el pivote cae por debajo de `PIVOT_EPSILON`
pone la columna a cero en vez de sacar la raíz de un número negativo. Eso no es una
descomposición inestable: es la descomposición correcta de una matriz positiva
**semi**definida.

Medido sobre tres series perfectamente correlacionadas (Σ de rango 1):

```
todas las entradas finitas = true
max |L·Lᵀ − Σ| = 2.711e-20
shocks generados: 0.004913, 0.009826, -0.004913
```

La reconstrucción es exacta hasta el ruido de coma flotante, y los shocks respetan las
relaciones que la covarianza describe: el segundo activo es exactamente 2× el primero y el
tercero exactamente −1×, que es justo lo que P0-1 pide simular («correlación positiva
perfecta», «correlación negativa»).

Devolver `null` habría roto ese caso, habría roto el test que ya existe
(`tests/lib/services/covariance.test.ts:117`, «handles a singular positive semi-definite
matrix (correlation ±1)») y habría cambiado un comportamiento correcto por una falsa alarma.

**No se modificó `covariance.ts`.** La tarea 1.2 del plan queda descartada.

### Segunda corrección — P0-14, benchmark configurable

**Añadido el 2026-09-16.** El diagnóstico afirmó (A8) que no había columna `benchmark` en
`portfolios`, ni persistencia, y que todo usaba `'SPY'`. **Eso era incorrecto.** La
migración 013 añadió `portfolios.benchmark_symbol` (`NOT NULL DEFAULT 'SPY'`),
`getPortfolioBenchmark()` la lee en `src/lib/services/benchmarks.ts:138`, las rutas de
riesgo, diagnóstico, salud y stress la usan, y `src/lib/schemas/portfolio.ts:17` ya acepta
`benchmark_symbol` al actualizar un portafolio.

El error vino de buscar `benchmark` en las migraciones con `head -5`, que solo mostró la
014/007 y cortó antes de la 013. Lo único que realmente falta es el **selector en la
interfaz**; la elección ya se guarda y se respeta. P0-14 pasa de PARCIAL 40% a PARCIAL
~80%.

### Tercera corrección — P0-9, frescura de datos

**Añadido el 2026-09-16, durante la tarea 4.4.** El diagnóstico dijo que `freshness.ts`
estaba **huérfano** y que la UI usaba dos banderas binarias ad-hoc: `allocation/route.ts:61`
y `portfolio.ts:124`. **La evidencia estaba mal citada, aunque la conclusión se sostenía.**

- `portfolio.ts:124` **no** era una bandera ad-hoc: ya derivaba `is_stale` de
  `freshnessOf()`. La búsqueda de importadores se hizo con la ruta `@/lib/services/freshness`
  y no vio el import relativo `./freshness`, así que el módulo no estaba sin importadores.
- Pero esa función, `enrichPositionsWithPnL`, **no tenía ningún llamador** en todo el
  repositorio. El veredicto de `freshness.ts` nunca llegaba a una pantalla, así que en la
  práctica sí estaba huérfano.
- La segunda bandera ad-hoc real no estaba en `portfolio.ts` sino en
  `src/app/(app)/portfolio/[id]/page.tsx:104` (`is_stale: livePrices != null &&
  !livePrices[pos.symbol]`), que es la que alimentaba la tabla de posiciones.

La tarea 4.4 conectó `freshness.ts` en los dos sitios reales, eliminó la función sin
llamadores y agregó un test de lint que impide otra definición local. P0-9 queda en
IMPLEMENTADO en ambos consumidores.
