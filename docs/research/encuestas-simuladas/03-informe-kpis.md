# Informe de resultados y KPIs — InvestTracker

**Estudio:** 24 encuestas anónimas + bitácora de 1 semana de portafolio simulado
**Semana observada:** lunes 3 → domingo 9 de agosto de 2026 · **168 fichas-día**
**Fecha del informe:** 2026-08-11

> ⚠️ **Datos simulados.** Todas las cifras provienen del dataset sintético generado por
> `scripts/encuestas/generar-encuestas.mjs`. No corresponden a personas reales. Ver
> `02-metodologia-y-calibracion.md`, sección 6 (limitaciones).

---

## 1. Resumen ejecutivo

InvestTracker sale **bien evaluado en usabilidad y en valor percibido**, y muestra un patrón de
uso saludable durante la semana de registro. Los dos frenos aparecen en el mismo sitio: **la capa
analítica**. La gente entra, registra y entiende su portafolio; donde se atora es al interpretar
lo que la plataforma le devuelve.

**Los cuatro hallazgos que importan:**

1. **La usabilidad base está resuelta.** SUS **82.3/100** (grado B, muy por encima del promedio
   de la industria de 68) y **92.5%** de éxito en tareas. Crear un portafolio y registrar la primera operación toma **3.0 minutos** en
   promedio, muy por debajo de la meta de 5.
2. **El producto engancha, pero por una sola pantalla.** Dashboard y Portafolios tienen 100% de
   adopción; Alertas (50%) y Discover (62.5%) se quedan atrás. El uso se concentra en «ver cómo
   voy», no en las funciones que retienen a largo plazo.
3. **Analytics es el cuello de botella.** Es el módulo peor calificado entre los que sí se usan
   (**3.84/5**, solo 73.7% de notas 4-5), la tarea más lenta (**162 s**) y la fuente de los dos KPIs
   en ámbar: CES **5.38/7** y confianza en las cifras **3.92/5**. Cuatro de los doce temas de mejora
   —educación de métricas, densidad de Analytics, frescura de precios, multidivisa— apuntan ahí.
4. **La adherencia se sostiene entre semana y se cae el fin de semana.** DAU medio de **22.6/24**
   en días hábiles contra **10/24** en sábado y domingo (−75% del lunes al domingo). Coherente
   con el mercado cerrado, pero indica que hoy no hay ninguna razón para abrir la app cuando no
   hay precios nuevos.

**Correlación relevante:** los promotores registraron **6.5 de 7 días** y pasaron **67 minutos** en
la app; los detractores, **3.5 días** y **21 minutos**. El uso sostenido y la satisfacción van juntos
(SUS ~ NPS: r = 0.65) — el mismo eje sobre el que conviene mover el producto.

---

## 2. Tablero de KPIs

| KPI | Meta | Resultado | Estado |
| --- | --- | --- | :---: |
| SUS (usabilidad) | ≥ 75 | **82.3/100** | 🟢 |
| NPS | ≥ +30 | **+33.3** | 🟢 |
| CSAT top-2 (4-5) | ≥ 80% | **87.5%** | 🟢 |
| CES (facilidad 1-7) | ≥ 5.5 | **5.38/7** | 🟡 |
| Tasa de éxito en tareas | ≥ 90% | **92.5%** | 🟢 |
| Tiempo al primer valor (TTFV) | ≤ 5 min | **3.02 min** | 🟢 |
| Adherencia al registro semanal | ≥ 70% | **79.2%** | 🟢 |
| Retención semanal (≥5 de 7 días) | ≥ 75% | **79.2%** | 🟢 |
| Intención de continuar (top-2) | ≥ 75% | **79.2%** | 🟢 |
| Acción sobre alertas | ≥ 50% | **69.6%** | 🟢 |
| Confianza en las cifras | ≥ 4.0/5 | **3.92/5** | 🟡 |
| Disposición a pagar | ≥ 50% | **66.7%** | 🟢 |

**10 de 12 KPIs en verde, 2 en ámbar, ninguno en rojo.** Los dos ámbar son el mismo problema
visto por dos lados: cuesta esfuerzo interpretar la información y eso erosiona la confianza en
las cifras.

---

## 3. Composición de la muestra

| Variable | Distribución |
| --- | --- |
| Edad | 25-34: 10 · 35-44: 6 · 18-24: 4 · 45-59: 4 |
| Experiencia | Principiante: 10 · Intermedio: 9 · Avanzado: 5 |
| Dispositivo principal | Móvil: 11 · Escritorio: 7 · Ambos: 6 |
| Perfil de riesgo (Asesor) | Moderado: 9 · Agresivo: 8 · Conservador: 7 |
| Herramienta previa | Ninguna: 8 · Hoja de cálculo: 6 · App del bróker: 6 · Fondo: 2 · Asesor: 2 |

Un tercio llegó **sin ninguna herramienta previa**: son quienes más dependen de que el producto
explique, y quienes concentran las quejas de educación de métricas y onboarding.

---

## 4. Usabilidad (SUS)

| Métrica | Valor |
| --- | --- |
| Media | **82.3** (grado B — bueno) |
| Mediana | 82.5 |
| Desv. estándar | 9.7 |
| IC 95% de la media | [78.2 – 86.4] |
| Rango | 57.5 – 97.5 |
| % por encima de 68 (promedio de industria) | **95.8%** (23 de 24) |

**Por experiencia:** Intermedio **85.8** · Avanzado **84.5** · Principiante **78.0**
**Por dispositivo:** Escritorio **85.4** · Ambos **82.5** · Móvil **80.2**

Los **7.8 puntos** de diferencia entre principiantes e intermedios son el hallazgo accionable:
la plataforma es fácil *si ya sabes de inversiones*. El único participante por debajo de 68
(**R22**, 57.5) es un estudiante principiante que se topó con la carga manual de operaciones
desde móvil. La brecha por dispositivo (−5.2 puntos en móvil) coincide con las tres menciones
de `ux_movil`.

---

## 5. Satisfacción y lealtad

| Métrica | Valor |
| --- | --- |
| **NPS** | **+33.3** (12 promotores · 8 pasivos · 4 detractores) |
| Nota media de recomendación | 8.0 / 10 |
| **CSAT** | 4.17 / 5 — **87.5%** dio 4 o 5 |
| **CES** (facilidad) | 5.38 / 7 🟡 |
| Intención de continuar | 4.08 / 5 — 79.2% en top-2 |
| Confianza en las cifras | **3.92 / 5** 🟡 |
| Claridad visual | 4.42 / 5 |
| Velocidad percibida | 4.13 / 5 |

**Disposición a pagar:** 66.7% pagaría algo (13 personas $49, 3 personas $99, 8 personas nada).
ARPU potencial **$38.9 MXN/mes**; ticket medio entre quienes pagarían, **$58.4 MXN**. Señal para
el modelo de negocio: hay disposición, pero anclada en la banda baja — el plan de pago debería
apuntar a ~$49–99 MXN, no a $149+.

**Lectura de los dos ámbar:** claridad visual (4.42) es alta mientras que confianza en las cifras
(3.92) es la más baja de la sección. La gente entiende *lo que ve*; duda de si el número es
correcto. Eso apunta a la frescura del dato y a la ausencia de trazabilidad («¿de cuándo es este
precio?», «¿por qué mi total cambió si no vendí nada?»), no al diseño visual.

---

## 6. Adopción y utilidad por módulo

| Módulo | Adopción | Usuarios | Utilidad media | % 4-5 | Usos/semana |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard | 100% | 24/24 | 4.38 | 91.7% | 5.8 |
| Portafolios y transacciones | 100% | 24/24 | **4.42** | 100% | 5.9 |
| Mercados | 83.3% | 20/24 | 4.35 | 95% | 6.2 |
| Analytics (riesgo y retornos) | 79.2% | 19/24 | **3.84** | 73.7% | 4.8 |
| Asesor (perfil + simulación) | 66.7% | 16/24 | 4.38 | 93.8% | 5.9 |
| Discover / Social | 62.5% | 15/24 | **3.60** | 60% | 4.8 |
| Watchlist | 58.3% | 14/24 | 4.21 | 92.9% | 5.9 |
| Alertas | 50% | 12/24 | 3.75 | 66.7% | 5.3 |

**Tres patrones:**

- **El núcleo funciona.** Portafolios es el módulo mejor calificado (4.42) y el único con 100% de
  notas 4-5. Nadie cuestiona el registro de operaciones.
- **Alertas es el mayor desperdicio.** Solo la mitad lo configuró, pero **quien lo usó actuó sobre
  el 69.6% de las alertas recibidas**. Es una función que funciona y que la gente no encuentra ni
  descubre: el problema es de activación, no de valor.
- **El Asesor es el sleeper.** 66.7% de adopción pero 93.8% de notas 4-5 y la mejor recepción entre
  principiantes. Es el mejor candidato para colocarse en el onboarding.

---

## 7. Eficiencia de tareas

| Tarea | Éxito | Tiempo medio | Mediana | P90 | Errores | Pidió ayuda |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| T1 · Crear un portafolio | 91.7% | 70.6 s | 70.5 s | 96.6 s | 0.42 | 12.5% |
| T2 · Registrar una compra | 95.8% | 100.7 s | 110 s | 134.8 s | 0.46 | 8.3% |
| T3 · Interpretar P&L y riesgo en Analytics | 91.7% | **161.9 s** | 155 s | **247.4 s** | 0.29 | 12.5% |
| T4 · Crear una alerta de precio | **87.5%** | 96.8 s | 96 s | 135 s | 0.29 | **16.7%** |
| T5 · Completar perfil del Asesor y leer la simulación | 95.8% | 189.8 s | 175 s | 317.6 s | 0.25 | 12.5% |

**Global:** 92.5% de éxito (111 de 120 intentos) · 1.71 errores por participante · 12.5% pidió ayuda
· solo **16.7%** completó las cinco tareas sin ningún error.

**TTFV (crear portafolio + primera compra):** media **181 s (3.0 min)**, mediana 178 s, P90 240 s.
La activación es rápida incluso en el peor decil.

**Dos tareas problemáticas, por razones distintas:**
- **T4 (alertas)** tiene la peor tasa de éxito (87.5%) y la mayor petición de ayuda (16.7%): la
  gente no encuentra dónde se crea una alerta. Problema de **descubribilidad**.
- **T3 (interpretar Analytics)** se completa (91.7%) pero es la más lenta en relación con su
  complejidad y tiene el P90 más disperso (247 s, 1.5× su mediana): la gente llega, pero le cuesta
  leer. Problema de **comprensión**.

---

## 8. Bitácora semanal: engagement

| Día | Fecha | Mercado | Activos | DAU | Sesiones | Minutos | Operaciones | Aportaciones |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Lunes | 2026-08-03 | Abierto | 24/24 | 100% | 61 | 221.1 | 17 | $7,100 |
| Martes | 2026-08-04 | Abierto | 24/24 | 100% | 57 | 213.9 | 15 | $0 |
| Miércoles | 2026-08-05 | Abierto | 22/24 | 91.7% | 62 | 226.5 | 16 | $0 |
| Jueves | 2026-08-06 | Abierto | 21/24 | 87.5% | 50 | 199.6 | 11 | $0 |
| Viernes | 2026-08-07 | Abierto | 22/24 | 91.7% | 61 | 192.8 | 24 | **$93,900** |
| Sábado | 2026-08-08 | Cerrado | 14/24 | 58.3% | 27 | 134 | 1 | $0 |
| Domingo | 2026-08-09 | Cerrado | 6/24 | 25% | 16 | 59.6 | 0 | $0 |

| KPI de engagement | Valor |
| --- | --- |
| Adherencia al registro | **79.2%** (133 de 168 fichas-día) |
| Días registrados por persona | 5.54 / 7 |
| Registro perfecto (7/7) | 6 personas |
| Retención semanal (≥5 días) | 19 de 24 (**79.2%**) |
| DAU medio | 19.0 / 24 |
| DAU días hábiles vs fin de semana | **22.6** vs **10.0** |
| Sesiones por persona | 13.5 en la semana |
| Minutos por persona | 51.7 en la semana |
| Minutos por sesión | **3.84** |
| Operaciones registradas | 86 (3.6 por persona) |
| Tasa de aportación | 54.2% aportó al menos una vez |
| Alertas: recibidas / accionadas | 56 / 39 → **69.6%** |

**Lo que cuenta la semana:**

- **El viernes es el día de dinero.** $93,900 de $110,500 en aportaciones (85%) y el pico de
  operaciones (24). El efecto quincena es tan marcado que justifica por sí solo un recordatorio de
  aportación programado en viernes.
- **Sesiones cortas y frecuentes.** 3.84 minutos por sesión, 13.5 sesiones por semana: el patrón es
  de *check-in*, no de análisis. Refuerza que el Dashboard —y no Analytics— es la pantalla que
  sostiene el hábito, y que lo que se ponga fuera de ella se usará poco.
- **El fin de semana el producto desaparece.** De 24 activos el lunes a 6 el domingo. Con mercado
  cerrado no hay dato nuevo que ver, y hoy no existe contenido (resumen semanal, educación, plan
  de aportación) que ocupe ese hueco.
- **El martes rojo no rompió el hábito.** El día de la caída (−0.55% medio, 96% de los portafolios
  en rojo) mantuvo 24/24 activos y 57 sesiones. Las malas noticias traen a la gente a la app; lo que
  importa es qué encuentra al llegar.

---

## 9. Desempeño del portafolio simulado

| Métrica agregada | Valor |
| --- | --- |
| Capital inicial total | $3,387,000 MXN |
| Aportaciones de la semana | $110,500 MXN |
| Valor final total | $3,504,812 MXN |
| P&L de la semana | **+$7,312 MXN** |
| Rendimiento TWR medio | **+0.263%** (mediana +0.343%) |
| IC 95% del rendimiento | [−0.11% – +0.64%] |
| Mejor / peor participante | +2.11% (R14) / −2.73% (R02) |
| Portafolios en positivo | **75%** (18 de 24) |
| Volatilidad anualizada media | 8.42% |
| Máximo drawdown medio / peor | −0.86% / −2.79% |

### Por perfil de riesgo

| Perfil | n | Capital medio | Rend. semana (TWR) | Vol. anualizada | Máx. drawdown | Sharpe aprox. | Operaciones |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Conservador | 7 | $132,286 | +0.051% | 3.05% | −0.33% | 1.08 | 2.71 |
| Moderado | 9 | $185,222 | +0.258% | 9.65% | −1.04% | 1.62 | 3.33 |
| Agresivo | 8 | $99,250 | +0.327% | 13.80% | −1.38% | 1.48 | 4.38 |

### Comportamiento diario del mercado simulado

| Día | Retorno medio | P&L agregado | % en verde |
| --- | ---: | ---: | ---: |
| Lunes | +0.355% | +$14,449 | 87.5% |
| Martes | **−0.551%** | **−$17,656** | 4.2% |
| Miércoles | +0.185% | +$4,511 | 75% |
| Jueves | −0.177% | −$8,408 | 33.3% |
| Viernes | +0.454% | +$14,410 | 87.5% |
| Sábado / Domingo | 0% (mercado cerrado) | $0 | — |

**Lecturas:**

- El ordenamiento riesgo-rendimiento **se cumple**: a mayor agresividad, más rendimiento, más
  volatilidad y más drawdown. La cartera del Asesor se comporta como promete.
- **El perfil agresivo opera 62% más** que el conservador (4.38 vs 2.71 operaciones). Combinado con
  el comentario de R24 («me hizo consciente de cuánto muevo la cartera sin necesidad»), sugiere que
  vale la pena mostrar el costo del sobre-trading.
- ⚠️ **Sharpe y volatilidad anualizada con 5 retornos no son estadísticamente interpretables.** Se
  incluyen porque son las métricas que la plataforma muestra al usuario, y parte del estudio es
  observar si se entienden — no para concluir sobre la calidad de las carteras.

---

## 10. Respuestas abiertas: temas de mejora

| Tema | Menciones | % | Participantes |
| --- | ---: | ---: | --- |
| `educacion_metricas` | 3 | 12.5% | R01 R13 R17 |
| `ux_movil` | 3 | 12.5% | R03 R11 R19 |
| `alertas_push` | 2 | 8.3% | R02 R16 |
| `densidad_analytics` | 2 | 8.3% | R06 R18 |
| `dividendos_impuestos` | 2 | 8.3% | R04 R21 |
| `importacion_csv` | 2 | 8.3% | R12 R22 |
| `multidivisa` | 2 | 8.3% | R09 R23 |
| `onboarding` | 2 | 8.3% | R05 R15 |
| `privacidad_social` | 2 | 8.3% | R07 R20 |
| `rendimiento_carga` | 2 | 8.3% | R14 R24 |
| `exportacion` | 1 | 4.2% | R10 |
| `frescura_precios` | 1 | 4.2% | R08 |

**Agrupados por causa raíz:**

| Causa raíz | Temas | Menciones |
| --- | --- | ---: |
| **Comprensión de la información** | educación de métricas + densidad de Analytics | **5** |
| **Experiencia móvil** | ux móvil + rendimiento de carga | **5** |
| **Entrada de datos** | importación CSV + dividendos/impuestos | **4** |
| **Notificación y salida** | alertas push + exportación | **3** |
| **Confianza en el dato** | multidivisa + frescura de precios | **3** |
| **Primera sesión** | onboarding | **2** |
| **Privacidad social** | privacidad social | **2** |

Citas representativas:

> «No entendí qué es el drawdown ni el Sharpe; me gustaría un "¿qué significa?" junto a cada métrica.» — R01
> «Las alertas solo se ven dentro de la app; necesito que lleguen al celular aunque esté cerrada.» — R02
> «El importador de CSV rechazó el archivo de mi bróker y no me dijo qué columna estaba mal.» — R12
> «Los precios a veces tardan en refrescar y no se ve la hora de la última actualización.» — R08

Y lo que más se valora:

> «Por fin veo todo mi portafolio junto y no repartido entre dos brókers.» — R02
> «La atribución por posición (waterfall) explica el P&L sin que yo tenga que calcular nada.» — R10
> «Las alertas de concentración me hicieron ver que tenía 40% en un solo activo.» — R09

---

## 11. Backlog priorizado

Prioridad = (menciones × impacto en KPI en ámbar) ÷ esfuerzo estimado.

| # | Acción | Evidencia | KPI que mueve | Esfuerzo |
| --- | --- | --- | --- | --- |
| 1 | **Glosario contextual** («¿qué significa?») en cada métrica de Analytics y en la simulación del Asesor | 5 menciones · T3 la más lenta · SUS principiantes −7.8 | CES, confianza, SUS principiantes | S |
| 2 | **Marca de tiempo y estado del dato** («actualizado hace X min») en precios y valor del portafolio | R08 · confianza 3.92 | Confianza en las cifras | S |
| 3 | **Notificaciones push y resumen semanal por correo** | 2 menciones · alertas 50% adopción con 69.6% de acción | Adopción de Alertas, DAU fin de semana | M |
| 4 | **Descubribilidad de Alertas**: acceso desde la ficha del activo y desde el Dashboard | T4 peor tasa de éxito (87.5%) y más ayuda (16.7%) | Éxito en tareas, adopción | S |
| 5 | **Analytics por secciones** con ventana temporal configurable (30/90/365 d) | R06, R18 · densidad | CES, utilidad de Analytics | M |
| 6 | **Importador CSV con validación explícita** (qué columna falló y cómo corregirla) | R12, R22 · el peor SUS del estudio | SUS principiantes, activación | M |
| 7 | **Tablas responsivas y áreas táctiles mayores** en móvil | 3 menciones · SUS móvil −5.2 | SUS móvil | M |
| 8 | **Total en doble divisa** (MXN y USD) con tipo de cambio visible | R09, R23 | Confianza en las cifras | M |
| 9 | **Onboarding que distinga portafolio de watchlist** y coloque el Asesor en el primer uso | R05, R15 · Asesor 93.8% de notas 4-5 pero 66.7% de adopción | TTFV, adopción del Asesor | S |
| 10 | **Registro de dividendos con retención** y proyección de ingresos | R04, R21 (ambos perfiles avanzados) | Retención de usuarios avanzados | L |
| 11 | **Previsualización de privacidad** («así te ven los demás») antes de publicar un portafolio | R07, R20 | Adopción de Discover | S |

**Si solo se hacen tres:** #1, #2 y #4. Son de esfuerzo bajo y atacan directamente los dos KPIs
en ámbar (CES y confianza) más la función con mayor desperdicio (Alertas).

---

## 12. Qué medir en la siguiente ronda

1. **Repetir con usuarios reales** y comparar contra este tablero; el 82.3 de SUS debe tratarse
   como techo optimista (ver limitaciones).
2. **Bitácora de 4 semanas** en vez de 1: la adherencia de una semana no distingue novedad de
   hábito, y la caída de fin de semana necesita más de dos observaciones.
3. **Instrumentar los mismos KPIs en producto** (adopción por módulo, TTFV, acción sobre alertas)
   para dejar de depender de la autodeclaración.
4. **Contrastar la hipótesis pendiente:** ¿una semana en rojo baja el NPS? En esta simulación
   resultado financiero y satisfacción son independientes por construcción; en campo hay que medirlo.
