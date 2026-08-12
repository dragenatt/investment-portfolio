# Presentación ejecutiva y técnica — InvestTracker

24 diapositivas en 16:9 (1280 × 720). Parte 1 (1–5): contexto del proyecto.
Parte 2 (6–24): guía de usuario paso a paso.

| Archivo | Qué es |
| --- | --- |
| `presentacion-investtracker.pdf` | **Listo para presentar.** 24 páginas, una por diapositiva. |
| `presentacion-investtracker.html` | Pieza autocontenida: tipografías y QR incrustados. |
| `presentacion.src.html` | Plantilla editable. **Edita este archivo**, no el anterior. |

## Campos por llenar

La portada tiene dos campos en blanco: **autor / equipo** e **institución**. Están en
`presentacion.src.html`, bloque `.ficha` de la diapositiva 1.

## Cómo editarla

```bash
# 1. Edita docs/presentacion/presentacion.src.html
# 2. Reconstruye:
node scripts/presentacion/construir.mjs
# 3. Exporta: abre el HTML en el navegador → Imprimir → Guardar como PDF, sin márgenes
```

Los códigos QR se reutilizan de `docs/poster/qr/` (mismo generador verificado).

**Cada diapositiva tiene alto fijo (720 px) y recorta lo que se desborde.** Al agregar contenido,
verifica que siga cabiendo: una diapositiva desbordada tendrá `scrollHeight > clientHeight`.

## Estructura

| # | Diapositiva |
| --- | --- |
| 1 | Portada e identidad institucional |
| 2 | Planteamiento del problema — cuatro fricciones |
| 3 | Propuesta de valor y solución |
| 4 | Objetivos general y específicos |
| 5 | Stack tecnológico y arquitectura en cinco capas |
| 6 | Divisor · Parte 2 |
| 7 | Módulo 1 · Login y autenticación |
| 8–9 | Módulo 2 · Tablero principal y anatomía de las cifras |
| 10–12 | Módulo 3 · Portafolio, activos e importación |
| 13–14 | Módulo 4 · Variaciones intradía y ejemplo trabajado |
| 15–17 | Módulo 5 · Historial, rendimiento y riesgo |
| 18–19 | Módulo 6 · Perfil de riesgo y simulación Monte Carlo |
| 20–22 | Complementos · Alertas, mercados y comunidad |
| 23 | Resultados de la evaluación |
| 24 | Conclusiones, trabajo futuro y recursos |

Cada diapositiva de la Parte 2 lleva los cuatro bloques obligatorios: **propósito**,
**instrucciones paso a paso**, **valor financiero y técnico** y **analogía** en la banda inferior.

## Precisiones técnicas respecto del brief original

El brief describía un stack que no coincide con el código. Las diapositivas usan el real:

| En el brief | En el repositorio |
| --- | --- |
| React + JSX + **Vite** | **Next.js 16** (App Router, React Server Components) + React 19 + TypeScript. No hay Vite: Next.js trae su propio compilador. |
| Datos vía **`yfinance`** | **Twelve Data** como fuente primaria y **Finnhub** como respaldo, desde un Worker de Cloudflare. `yfinance` es una biblioteca de Python; este proyecto es TypeScript. |
| Backend/API con Node.js | Correcto: Route Handlers de Next.js sobre Node, más **Supabase** (PostgreSQL, autenticación y RLS) y **Upstash Redis**. |

Sobre el Módulo 4: el ancla de la variación diaria es el **cierre anterior**, que es la definición
estándar de «cambio del día» en los mercados. El trabajo programado que la captura corre a las
14:35 UTC, justo después de la apertura de Nueva York (`src/app/api/cron/baselines/route.ts`).
