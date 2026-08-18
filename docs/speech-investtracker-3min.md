# InvestTracker — Speech de presentación (≤ 3 minutos)

**Duración objetivo:** ~2:55 · ~400 palabras · ritmo ~140 palabras/min
**Formato:** presentación de producto (demo, pitch interno, entrega de proyecto)
**Nota:** todas las cifras están verificadas contra fuente primaria. Ver
[Banco de datos](#banco-de-datos--fuentes-verificadas) al final.

---

## 1. Apertura — el dato que abre *(0:00 – 0:30)*

En México, según la Encuesta Nacional de Inclusión Financiera del INEGI y la
CNBV, solo el **3.4 % de los adultos** tiene un fondo de inversión o un depósito
a plazo. Tres punto cuatro por ciento.

Y al mismo tiempo, la AMIB reportó que los inversionistas activos en fondos
pasaron de **menos de tres millones a 13.1 millones en cinco años**.

O sea: casi nadie invierte todavía, pero los que empiezan están llegando en
masa. Y llegan sin herramientas.

## 2. El problema — con evidencia *(0:30 – 1:10)*

¿Y qué pasa cuando inviertes sin medir? Hay dos estudios que lo responden.

Morningstar publicó *Mind the Gap* en 2025: en diez años, los fondos en Estados
Unidos rindieron **8.2 % anual**, pero el dinero de los inversionistas solo ganó
**7.0 %**. Un punto dos porcentuales al año, perdidos — no por malos fondos,
sino por mal *timing*. Y el detalle que importa: entre quienes más movían su
dinero, la brecha crecía a **1.8 puntos**; entre quienes estaban diversificados,
casi desaparecía: **0.1**.

Barber y Odean, en el *Journal of Finance*, lo vieron aún más crudo: de 66 mil
hogares, los que más operaban ganaron **11.4 % anual** mientras el mercado daba
**17.9 %**.

El enemigo no es el mercado. Es no saber cómo vas.

## 3. Qué es InvestTracker *(1:10 – 2:00)*

**InvestTracker** ataca exactamente eso.

Reúne todo tu patrimonio en un solo lugar: seis tipos de activo —acciones,
ETFs, cripto, bonos y CETES, divisas y commodities—, de la Bolsa Mexicana y de
Estados Unidos, todo en tu moneda base.

Y calcula lo que casi ninguna app muestra: **rendimiento ponderado por tiempo y
por dinero — TWR y MWR**. Esa diferencia *es* la brecha de
Morningstar. InvestTracker te la pone en pantalla.

Encima de eso: volatilidad, Sharpe, máximo *drawdown*, comparación contra
*benchmark* y atribución por activo y sector. **Alertas de concentración**, que
avisan cuando un activo pesa demasiado — el problema exacto que Morningstar
midió. Y un asesor que te perfila y simula tu meta con Monte Carlo.

## 4. Cómo está construido *(2:00 – 2:30)*

Por dentro: **Next.js 16 y React 19** en Vercel. **Supabase** con Row Level
Security: cada usuario solo ve lo suyo. Un **Worker en Cloudflare** que actualiza
precios por cron, **caché en Redis**, y **tres proveedores de mercado** —Yahoo,
Finnhub y Twelve Data— con *fallback*: si uno falla, la aplicación sigue en pie.

## 5. Cierre *(2:30 – 2:55)*

La misma ENIF encontró algo más: de quienes llevan registro de sus gastos, solo
el **19.5 %** usa una herramienta digital. El resto: memoria, papel o Excel.

InvestTracker es esa herramienta que falta, para el lado de las inversiones.
Porque no puedes mejorar lo que no mides.

Gracias.

---

## Banco de datos — fuentes verificadas

### 1. INEGI / CNBV — Encuesta Nacional de Inclusión Financiera (ENIF) 2024
*Comunicado de prensa 49/25, 13 de marzo de 2025. Base: población de 18 a 70 años.*

| Dato | Cifra |
|---|---|
| Población con **depósito a plazo fijo o fondo de inversión** | **3.4 %** (era 2.1 % en 2021) |
| Población con al menos una cuenta de ahorro formal | 63.0 % (+18.9 pp desde 2015) |
| Población con al menos un producto financiero | 76.5 % |
| Población que llevó registro de sus gastos | 65.3 % |
| — de ese grupo, quienes usan **apps o herramientas de administración financiera** | **19.5 %** |
| — de ese grupo, quienes llevan un presupuesto formal | 23.9 % |

→ https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/enif/ENIF2024_CP.pdf

### 2. AMIB — Foro de Fondos 2025
*Álvaro García Pimentel, presidente de la AMIB, 27 de mayo de 2025.*

- Personas activas en fondos de inversión: **de menos de 3 millones a 13.1 millones en 5 años** (+400 %).
- Total de inversionistas en el sistema bursátil mexicano: **31 millones**.
- Activos bajo administración: **4.5 billones de pesos** (el doble que 2.4 billones).

→ https://es-us.noticias.yahoo.com/foro-fondos-amib-2025-31-160000945.html

### 3. Morningstar — *Mind the Gap* 2025
*Publicado agosto 2025. Periodo: 10 años terminados el 31 de diciembre de 2024.
Universo: fondos mutuos y ETFs de EE. UU.*

- Retorno del inversionista (ponderado por dinero): **7.0 % anual**.
- Retorno total del fondo (ponderado por tiempo): **8.2 % anual**.
- **Brecha: –1.2 puntos porcentuales al año.**
- Por volatilidad de flujos (proxy de cuánto operan): del quintil que menos opera
  **–0.8 pp** al que más opera **–1.8 pp**.
- Por estilo: fondos de **asignación / diversificados –0.1 pp** (capturan ~97 % del
  rendimiento); **sector equity –1.5 pp**; bonos, solo la mitad del rendimiento.

→ https://www.morningstar.com/business/insights/research/mind-the-gap

### 4. Barber & Odean (2000) — *Trading Is Hazardous to Your Wealth*
*The Journal of Finance, Vol. LV, No. 2, abril 2000. Cita textual del abstract.*

> "Of 66,465 households with accounts at a large discount broker during 1991 to
> 1996, those that trade most earn an annual return of 11.4 percent, while the
> market returns 17.9 percent. The average household earns an annual return of
> 16.4 percent […] and turns over 75 percent of its portfolio annually."

→ https://onlinelibrary.wiley.com/doi/abs/10.1111/0022-1082.00226

---

## Notas de entrega

- **Si te preguntan por Morningstar:** existe una réplica académica (Fulkerson,
  Jordan, Riley & Yan, *Financial Analysts Journal*) que cuestiona el encuadre de
  "los inversionistas pierden 15 % de sus rendimientos". La brecha de **1.2 pp
  anuales** no está en disputa; lo debatido es cómo se traduce a un porcentaje del
  rendimiento total. Por eso el speech cita los puntos porcentuales, no el 15 %.
- **Barber & Odean es de 2000.** Si alguien objeta la antigüedad: es el estudio
  seminal y sigue siendo la referencia canónica; Morningstar 2025 confirma el
  mismo patrón con datos actuales. Ese es el argumento, no la fecha.
- **La AMIB es fuente secundaria** (cobertura del evento con cita directa del
  presidente). Si el público es técnico, atribúyelo como "según la AMIB", no como
  dato oficial de la CNBV.
- **Pausa fuerte** después de "Tres punto cuatro por ciento", después de "Es no
  saber cómo vas", y antes de "Gracias".
- **Si te falta tiempo:** recorta la arquitectura (sección 4) a una sola frase.
  La evidencia (sección 2) es el corazón del argumento — no la toques.
- **Si te sobra tiempo:** el puente más fuerte es TWR vs MWR. Explícalo con un
  ejemplo: "si metiste más dinero justo antes de una caída, tu MWR será peor que
  tu TWR — y esa distancia es tu costo por mal timing".
