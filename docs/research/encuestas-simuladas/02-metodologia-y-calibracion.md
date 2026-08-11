# Metodología y calibración de la simulación

> ⚠️ **Los datos de `data/` son sintéticos.** Fueron generados por un script determinista,
> no recolectados de personas reales. Su propósito es **diseñar, probar y validar el tablero
> de KPIs** antes de aplicar el instrumento en campo. Ningún número de este paquete debe
> presentarse como evidencia empírica sobre usuarios reales.

---

## 1. Qué se simuló

| Elemento | Cantidad |
| --- | --- |
| Participantes anónimos | 24 (`R01`…`R24`) |
| Ítems cerrados por participante | 10 SUS + 8 experiencia + 8 módulos × 3 + 5 tareas × 4 |
| Observaciones de bitácora | 24 × 7 = **168 filas-día** |
| Respuestas abiertas | 48 (2 por participante) |
| Semana observada | lunes 2026-08-03 → domingo 2026-08-09 |

## 2. Reproducibilidad

```bash
node scripts/encuestas/generar-encuestas.mjs   # escribe los 8 CSV
node scripts/encuestas/calcular-kpis.mjs       # escribe kpis.json y tablas-kpi.md
```

- PRNG **mulberry32** con semilla fija `20260811`. Misma semilla ⇒ mismos archivos byte a byte.
- La generación y el cálculo están **separados a propósito**: `calcular-kpis.mjs` no sabe nada
  de cómo nacieron los datos. Cuando existan respuestas reales con el mismo esquema de CSV,
  el mismo script produce el tablero sin tocar una línea.

## 3. Modelo de respuesta

### 3.1 Factor latente de satisfacción

Cada participante tiene un valor `sat ∈ [−1.4, +1.7]` asignado a mano y coherente con su
perfil y sus comentarios abiertos. De él se derivan, con ruido gaussiano independiente, los
ítems SUS, CSAT, CES, intención de continuar, confianza, claridad, velocidad y disposición a
pagar. Por eso las escalas **correlacionan entre sí** (SUS ~ NPS: **r = 0.65**) en lugar de ser
ruido independiente, que es lo que ocurre en datos reales y lo que hace que el tablero se
comporte de forma realista al cruzarlo.

| Escala | Fórmula base (antes de redondear y acotar) |
| --- | --- |
| SUS ítem impar | `4.05 + 0.55·sat + 0.45·ε` |
| SUS ítem par | `1.85 − 0.50·sat + 0.45·ε` |
| CSAT (1-5) | `3.75 + 0.70·sat + 0.40·ε` |
| CES (1-7) | `5.25 + 0.85·sat + 0.50·ε` |
| Intención (1-5) | `3.90 + 0.65·sat + 0.35·ε` |
| Confianza (1-5) | `3.85 + 0.50·sat + 0.40·ε` |

### 3.2 NPS controlado por rango

El NPS **no** se derivó de una fórmula continua: se ordenó a los 24 participantes por `sat` y
se asignó **12 promotores / 8 pasivos / 4 detractores**, mezcla que produce **NPS = +33**. Es una
decisión de calibración explícita: se buscó un escenario «MVP con buena tracción pero con
detractores reales», no un resultado perfecto. Cambiar esos tres números es la forma de
simular escenarios alternativos (pesimista, optimista) sin tocar el resto del modelo.

### 3.3 Adopción y utilidad por módulo

Probabilidad de adopción configurada por módulo, ajustada por `±0.06·sat`:

| Módulo | Adopción configurada | Utilidad base |
| --- | ---: | ---: |
| Dashboard | 100% | 4.45 |
| Portafolios y transacciones | 100% | 4.30 |
| Mercados | 88% | 4.05 |
| Analytics | 79% | 3.75 |
| Asesor | 75% | 4.20 |
| Watchlist | 71% | 3.95 |
| Alertas | 63% | 3.60 |
| Discover / Social | 46% | 3.35 |

Con n = 24 la adopción observada se desvía de la configurada (p. ej. Watchlist 71% → 58%
observado): es el error de muestreo esperado y sirve para recordar que **cada punto porcentual
del tablero vale ~0.4 participantes**.

### 3.4 Tareas cronometradas

Tiempo = `base × factor_experiencia × factor_dispositivo × factor_fallo × e^(σ·ε)` (lognormal),
con `factor_experiencia` = 1.22 principiante / 1.00 intermedio / 0.84 avanzado, `+8%` si el
dispositivo principal es móvil y `×1.55` si la tarea falla (los fallos tardan más que los éxitos).
Las medias de tiempo del tablero se calculan **solo sobre intentos exitosos**, que es la
convención estándar; los fallos se reportan aparte como tasa de éxito.

## 4. Modelo del portafolio simulado

### 4.1 Carteras y parámetros

Las carteras por perfil son **las mismas que muestra el módulo Asesor de la plataforma**
(`CARTERAS` en `src/lib/utils/investment-profile.ts`), y los rendimientos esperados anuales
son los de `RENDIMIENTOS`:

| Perfil | Cartera sugerida | μ anual | σ anual |
| --- | --- | ---: | ---: |
| Conservador | CETES 40 / Bonos 30 / ETF S&P500 20 / FIBRAS 10 | 4% | 4% |
| Moderado | CETES 20 / Bonos 20 / S&P500 35 / Nasdaq 15 / FIBRAS 10 | 7% | 9% |
| Agresivo | S&P500 40 / Nasdaq 25 / Emergentes 20 / FIBRAS 10 / Oro 5 | 11% | 16% |

Conversión a diario: `μ_d = μ/252`, `σ_d = σ/√252`.

### 4.2 Factor de mercado común

Los 24 portafolios viven **la misma semana**, así que comparten un factor de mercado por día
(en desviaciones estándar):

| Día | Lun | Mar | Mié | Jue | Vie | Sáb | Dom |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Factor `z` | +0.85 | −1.35 | +0.55 | −0.25 | +1.05 | cerrado | cerrado |

Retorno diario de cada participante:

```
r = μ_d + σ_d · (0.8 · z_día + 0.6 · ε)
```

El 80% del movimiento es mercado común y el resto idiosincrásico. Sin esta estructura, los
participantes tendrían semanas contradictorias entre sí y cualquier análisis agregado
(«el martes el 96% quedó en rojo») sería incoherente. Sábado y domingo el mercado está
cerrado: `r = 0` y el valor solo cambia si hay aportación.

### 4.3 Aportaciones y adherencia

- Aportaciones: 35% de probabilidad el lunes (3% del capital), 55% el viernes —efecto
  quincena— (5%), 12% en fin de semana (2%).
- Días omitidos en el registro según `sat`: los más satisfechos registran 7/7; los menos,
  hasta 4 días. Se omiten preferentemente fin de semana y jueves. Resultado: **79.2% de
  adherencia** (133 de 168 fichas-día).
- **El mercado se mueve aunque el participante no registre**: los días omitidos conservan su
  retorno y su valor de portafolio, y solo se ponen en cero las métricas de actividad. Así, la
  serie financiera queda completa y la adherencia es un KPI de producto, no un hueco en los datos.

## 5. Elección de metas del tablero

| KPI | Meta | De dónde sale |
| --- | --- | --- |
| SUS ≥ 75 | Por encima del promedio de la industria (68), grado C+ |
| NPS ≥ +30 | Umbral habitual de «bueno» en software de consumo |
| CSAT top-2 ≥ 80% | Convención de CSAT en producto |
| CES ≥ 5.5 / 7 | Zona alta de la escala de esfuerzo |
| Éxito en tareas ≥ 90% | Estándar de pruebas de usabilidad moderadas |
| TTFV ≤ 5 min | Objetivo de producto: activación en la primera sesión |
| Adherencia ≥ 70% | Diarios de 7 días con recordatorio |
| Retención semanal ≥ 75% | Proporción que sostiene el hábito ≥5 de 7 días |
| Acción sobre alertas ≥ 50% | Que la alerta provoque una visita, no solo un badge |

## 6. Limitaciones (importantes al leer el informe)

1. **Los datos son sintéticos.** El tablero está validado; las conclusiones sobre usuarios, no.
2. **n = 24.** Suficiente para usabilidad (los problemas se saturan hacia n≈12–15), insuficiente
   para inferencia poblacional. Los IC95 del informe son anchos a propósito.
3. **Una sola semana.** Un Sharpe o una volatilidad anualizada calculados con 5 retornos son
   ilustrativos, no estadísticamente significativos. Se reportan porque son las métricas que la
   plataforma muestra, y parte del estudio es ver si el usuario las entiende.
4. **Independencia entre resultado financiero y satisfacción.** En la simulación, a quien le fue
   mal en la semana no baja su NPS. En campo esa correlación probablemente exista y es una de
   las primeras hipótesis a contrastar con datos reales.
5. **Sin sesgo de no respuesta.** Todos los participantes contestaron todo. En campo habrá
   abandono, y suele concentrarse en los menos satisfechos, lo que **infla** los KPIs.
6. **Deseabilidad social.** Un estudio moderado tiende a producir SUS y NPS más altos que un
   despliegue en abierto. Trátese el 82.3 como techo optimista.
