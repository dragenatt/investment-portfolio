# Instrumento de encuesta — InvestTracker

**Versión:** 1.0 · **Fecha:** 2026-08-11 · **Duración estimada:** 12–15 min + 7 días de bitácora
**Modalidad:** autoaplicada (formulario web) + bitácora diaria + sesión de tareas cronometradas

> ⚠️ **Aviso.** Este documento define el cuestionario. Las respuestas incluidas en
> `data/` son **simuladas (sintéticas)**: no provienen de personas reales. Ver
> `02-metodologia-y-calibracion.md`.

---

## Aviso de anonimato y tratamiento de datos

Esta encuesta es **anónima**. Concretamente:

- **No se solicita** nombre, correo, teléfono, RFC, CURP, número de cuenta ni ningún
  dato que permita identificar a la persona.
- Cada participante recibe un **código seudónimo** (`R01` … `R24`) generado al azar y
  entregado en papel al inicio. No existe tabla que vincule el código con una identidad.
- Los datos demográficos se capturan **en rangos** (edad, no fecha de nacimiento;
  segmento ocupacional, no empleador) para evitar reidentificación por cruce.
- Las cifras del portafolio son de un **portafolio simulado con dinero ficticio**
  asignado para el estudio. Nadie reporta su patrimonio real.
- Los comentarios abiertos se revisan antes de publicarse para eliminar cualquier
  dato identificable que se haya escrito por descuido.
- Los resultados se difunden **solo en forma agregada**. Ningún corte se publica con
  menos de 3 participantes.
- La participación es voluntaria y puede interrumpirse en cualquier momento sin
  consecuencia; los datos parciales se descartan si la persona lo pide.

**Consentimiento.** ☐ He leído lo anterior y acepto participar de forma anónima.

---

## Sección A · Perfil del participante (contexto, no identificación)

| # | Pregunta | Tipo | Opciones |
| --- | --- | --- | --- |
| A1 | Rango de edad | Opción única | 18-24 · 25-34 · 35-44 · 45-59 · 60+ |
| A2 | Segmento ocupacional | Opción única | Estudiante · Profesional asalariado · Independiente/Emprendedor · Jubilado · Otro |
| A3 | Experiencia invirtiendo | Opción única | Principiante (<1 año) · Intermedio (1-5 años) · Avanzado (>5 años) |
| A4 | ¿Con qué llevabas tus inversiones antes? | Opción única | Nada · Hoja de cálculo · App del bróker · Asesor financiero · Otra app |
| A5 | Dispositivo principal durante la prueba | Opción única | Móvil · Escritorio · Ambos por igual |
| A6 | Perfil de riesgo que te asignó el módulo **Asesor** | Opción única | Conservador · Moderado · Agresivo · No completé el módulo |

*Campos derivados:* `cartera_sugerida` (la que muestra el Asesor para ese perfil) y
`capital_inicial_mxn` (capital ficticio asignado para la bitácora).

---

## Sección B · Usabilidad — Escala SUS (System Usability Scale)

Escala 1–5: **1 = totalmente en desacuerdo**, **5 = totalmente de acuerdo**.
Los ítems impares están redactados en positivo y los pares en negativo (control de aquiescencia).

| # | Ítem |
| --- | --- |
| SUS-01 | Creo que usaría InvestTracker con frecuencia. |
| SUS-02 | Encontré la plataforma innecesariamente compleja. |
| SUS-03 | Me pareció fácil de usar. |
| SUS-04 | Creo que necesitaría ayuda de alguien con conocimientos técnicos para usarla. |
| SUS-05 | Las funciones de la plataforma están bien integradas entre sí. |
| SUS-06 | Encontré demasiada inconsistencia en la plataforma. |
| SUS-07 | Imagino que la mayoría de la gente aprendería a usarla rápidamente. |
| SUS-08 | Me pareció muy engorrosa de usar. |
| SUS-09 | Me sentí con confianza al usarla. |
| SUS-10 | Necesité aprender muchas cosas antes de poder avanzar. |

**Cálculo del puntaje SUS** (0–100):

```
SUS = ( Σ(ítems impares − 1) + Σ(5 − ítems pares) ) × 2.5
```

Referencia de interpretación: 68 = promedio de la industria; ≥ 80.3 = percentil 90 (grado A).

---

## Sección C · Utilidad y adopción por módulo

Para **cada módulo**: ¿lo usaste durante la prueba? (Sí/No). Si la respuesta es *Sí*,
califica su utilidad de 1 a 5 e indica cuántas veces lo usaste en la semana.

| Módulo | Qué se evalúa |
| --- | --- |
| **Dashboard** | Valor del portafolio, ganancia del día/total, distribución, actividad reciente |
| **Portafolios y transacciones** | Crear portafolio, registrar compras/ventas, editar, importar CSV, exportar |
| **Analytics** | Retornos, riesgo (volatilidad, drawdown, Sharpe), atribución, benchmark, income |
| **Mercados** | Búsqueda de símbolos, precio, fundamentales, eventos, señal técnica, sectores |
| **Watchlist** | Listas de seguimiento de activos |
| **Alertas** | Reglas de precio y alertas de concentración |
| **Asesor** | Cuestionario de perfil, cartera sugerida, simulación Monte Carlo, meta de aportación |
| **Discover / Social** | Portafolios públicos, leaderboard, seguir a otros usuarios |

---

## Sección D · Tareas cronometradas (sesión moderada)

El moderador cronometra y observa. **No se ayuda** salvo bloqueo total (>3 min), y en ese
caso se marca `pidió_ayuda = Sí` y la tarea como fallida si no se completó sola.

| Tarea | Enunciado que se lee al participante | Criterio de éxito |
| --- | --- | --- |
| **T1** | «Crea un portafolio nuevo llamado *Mi cartera*.» | El portafolio existe y aparece en la lista |
| **T2** | «Registra que compraste 10 acciones de VOO a 480 dólares.» | La transacción queda guardada con símbolo, cantidad y precio correctos |
| **T3** | «Dime cuánto ganaste o perdiste esta semana y qué tan riesgoso es tu portafolio.» | Cita el P&L y al menos una métrica de riesgo del módulo Analytics |
| **T4** | «Haz que la plataforma te avise si VOO baja de 450 dólares.» | La alerta queda creada y activa |
| **T5** | «Averigua qué cartera te recomienda la plataforma y cuánto tendrías en 10 años.» | Completa el cuestionario del Asesor y lee un resultado de la simulación |

Se registra por tarea: **éxito (1/0)**, **segundos**, **errores** (acciones incorrectas o
callejones sin salida) y **si pidió ayuda**.

**Derivado — TTFV (*time to first value*):** segundos de T1 + T2, es decir, cuánto tarda
alguien desde cero hasta tener un portafolio con una operación registrada.

---

## Sección E · Satisfacción, esfuerzo y lealtad

| # | Pregunta | Escala |
| --- | --- | --- |
| E1 | **NPS** — ¿Qué tan probable es que recomiendes InvestTracker a un amigo o colega? | 0–10 |
| E2 | **CSAT** — En general, ¿qué tan satisfecho quedaste con la plataforma? | 1–5 |
| E3 | **CES** — «La plataforma me facilitó llevar el control de mis inversiones.» | 1–7 |
| E4 | ¿Seguirías usándola después del estudio? | 1–5 |
| E5 | ¿Confías en que las cifras que muestra son correctas? | 1–5 |
| E6 | Claridad visual de la información | 1–5 |
| E7 | Velocidad percibida de la aplicación | 1–5 |
| E8 | ¿Cuánto pagarías al mes por ella? | $0 · $49 · $99 · $149 · $199 MXN |

*Clasificación NPS:* 9–10 promotor · 7–8 pasivo · 0–6 detractor. `NPS = %promotores − %detractores`.

---

## Sección F · Bitácora de 1 semana del portafolio simulado

> **Este es el apartado longitudinal de la encuesta.** A cada participante se le asigna un
> **capital ficticio en MXN** y la **cartera que le sugirió el Asesor** según su perfil. Durante
> **7 días naturales (lunes a domingo)** registra en la plataforma lo que hizo y lo que pasó con
> su portafolio. Se llena **una fila por día**, incluso los días sin movimiento.

**Semana observada en el dataset simulado:** lunes 3 → domingo 9 de agosto de 2026.
Días 1–5 con mercado abierto; días 6–7 (sábado y domingo) con mercado cerrado.

### Ficha diaria

| Campo | Cómo se obtiene | Tipo |
| --- | --- | --- |
| `dia` / `fecha` / `dia_semana` | Automático | 1–7 |
| `mercado` | Automático | Abierto / Cerrado |
| `registro_completado` | Si el participante llenó la ficha ese día | Sí / No |
| `sesiones` | Veces que abrió la app ese día | Entero |
| `minutos_en_app` | Tiempo total dentro de la app | Decimal |
| `operaciones_registradas` | Compras/ventas capturadas ese día | Entero |
| `aportacion_mxn` | Dinero (ficticio) añadido al portafolio | MXN |
| `retorno_dia_pct` | Rendimiento del portafolio ese día | % |
| `pnl_dia_mxn` | Ganancia/pérdida del día, **sin contar la aportación** | MXN |
| `valor_portafolio_mxn` | Valor de cierre del portafolio | MXN |
| `pnl_acumulado_mxn` | P&L acumulado de la semana | MXN |
| `indice_twr` | Índice de rendimiento ponderado por tiempo (base 1.0) | Decimal |
| `alertas_recibidas` / `alertas_accionadas` | Alertas que le llegaron y en cuántas actuó | Entero |
| `nota_del_participante` | Comentario libre del día (una línea) | Texto |

### Reglas de cálculo

```
valor_t   = valor_(t−1) × (1 + retorno_t) + aportación_t
pnl_dia_t = valor_(t−1) × retorno_t          ← la aportación NO es ganancia
TWR_t     = TWR_(t−1) × (1 + retorno_t)      ← aísla el rendimiento del dinero nuevo
drawdown  = TWR_t / máx(TWR_0..t) − 1
```

La distinción entre `pnl` y `aportación` es deliberada: es el error de interpretación más
común entre principiantes («subió mi portafolio» cuando en realidad solo depositó dinero) y
uno de los puntos que el estudio busca observar.

### Preguntas de cierre de la bitácora (día 7)

| # | Pregunta | Escala |
| --- | --- | --- |
| F1 | ¿El registro diario te ayudó a entender mejor tu portafolio? | 1–5 |
| F2 | ¿Cuántos días te resultó fácil mantener el hábito? | 0–7 |
| F3 | ¿Alguna cifra de la plataforma no te cuadró con lo que esperabas? | Abierta |

---

## Sección G · Preguntas abiertas

| # | Pregunta | Codificación |
| --- | --- | --- |
| G1 | ¿Qué es lo que **más valoras** de la plataforma? | `valor_percibido` |
| G2 | Si pudieras cambiar **una sola cosa**, ¿cuál sería? | Tema codificado (ver abajo) |

**Catálogo de temas para G2** (codificación cerrada, un tema por respuesta):

`onboarding` · `ux_movil` · `densidad_analytics` · `educacion_metricas` · `alertas_push` ·
`importacion_csv` · `multidivisa` · `dividendos_impuestos` · `frescura_precios` ·
`rendimiento_carga` · `privacidad_social` · `exportacion`

---

## Mapa de KPIs

Qué alimenta cada sección del cuestionario:

| Sección | KPIs que produce |
| --- | --- |
| A | Cortes por segmento, experiencia, dispositivo y perfil de riesgo |
| B | **SUS** medio, mediana, IC95, % sobre el umbral 68, grado A–F |
| C | **Adopción por módulo**, utilidad media, % top-2, frecuencia de uso |
| D | **Tasa de éxito**, tiempo medio/mediana/P90, errores, % que pidió ayuda, **TTFV** |
| E | **NPS**, **CSAT**, **CES**, intención de continuar, confianza, disposición a pagar |
| F | **Adherencia al registro**, DAU, retención semanal, sesiones, minutos, operaciones, tasa de aportación, acción sobre alertas, **rendimiento TWR**, volatilidad, drawdown |
| G | Ranking de **temas de mejora** priorizado por menciones |
