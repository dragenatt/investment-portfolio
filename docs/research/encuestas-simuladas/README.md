# Encuestas simuladas y KPIs — InvestTracker

Paquete de investigación de producto con **24 encuestas anónimas simuladas**, una **bitácora de
1 semana de portafolio simulado** por participante y el **tablero de KPIs** derivado.

> ## ⚠️ Datos simulados
>
> Todo el contenido de `data/` es **sintético**: fue generado por un script determinista, no
> recolectado de personas reales. Sirve para **diseñar y validar el tablero de KPIs antes de
> aplicar el instrumento en campo**. No debe citarse como evidencia empírica sobre usuarios
> reales. Si estas cifras se comparten fuera del equipo, este aviso debe ir con ellas.

---

## Contenido

| Archivo | Qué es |
| --- | --- |
| [`01-instrumento-encuesta.md`](01-instrumento-encuesta.md) | El cuestionario completo: anonimato, 7 secciones (A–G), fichas de la bitácora diaria, protocolo de tareas cronometradas y mapa de KPIs |
| [`02-metodologia-y-calibracion.md`](02-metodologia-y-calibracion.md) | Cómo se simuló cada respuesta, parámetros del modelo financiero, metas del tablero y **limitaciones** |
| [`03-informe-kpis.md`](03-informe-kpis.md) | Resultados, tablero de 12 KPIs, análisis por módulo/tarea/día, desempeño del portafolio y backlog priorizado |

### Datos (`data/`)

| Archivo | Filas | Contenido |
| --- | ---: | --- |
| `01-participantes.csv` | 24 | Perfil anónimo: rango de edad, segmento, experiencia, perfil de riesgo, dispositivo, capital ficticio |
| `02-usabilidad-sus.csv` | 24 | Los 10 ítems SUS + puntaje calculado |
| `03-experiencia-nps-csat.csv` | 24 | NPS, CSAT, CES, intención, confianza, claridad, velocidad, disposición a pagar |
| `04-adopcion-modulos.csv` | 192 | 8 módulos × 24: si lo usó, utilidad 1-5, frecuencia semanal |
| `05-tareas-usabilidad.csv` | 120 | 5 tareas × 24: éxito, segundos, errores, si pidió ayuda |
| `06-bitacora-semanal.csv` | **168** | 7 días × 24: sesiones, minutos, operaciones, aportación, retorno, P&L, valor, TWR, alertas y nota del día |
| `07-resumen-portafolio.csv` | 24 | Consolidado por participante: rendimiento TWR, volatilidad, drawdown, Sharpe, adherencia |
| `08-comentarios-abiertos.csv` | 48 | 2 respuestas abiertas por participante, con tema codificado |
| `kpis.json` | — | Todos los KPIs calculados, en formato consumible por código |
| `tablas-kpi.md` | — | Tablas del informe, autogeneradas |

---

## Reproducir

```bash
node scripts/encuestas/generar-encuestas.mjs   # regenera los 8 CSV (semilla fija: 20260811)
node scripts/encuestas/calcular-kpis.mjs       # recalcula kpis.json y tablas-kpi.md
```

La generación es determinista: misma semilla ⇒ mismos archivos byte a byte.

**Los dos scripts están separados a propósito.** `calcular-kpis.mjs` no sabe cómo nacieron los
datos: lee los CSV y calcula. Cuando existan **respuestas reales** con el mismo esquema, basta con
sustituir los archivos de `data/` y volver a ejecutar el segundo script para obtener el tablero
—sin tocar una línea de código.

Para simular otros escenarios (pesimista, optimista), los tres puntos de calibración son:
el reparto promotores/pasivos/detractores, los valores `sat` de los participantes y las
probabilidades de adopción por módulo. Están documentados en `02-metodologia-y-calibracion.md`.

---

## Resultado en una línea

**10 de 12 KPIs en verde** (SUS 82.3 · NPS +33 · CSAT 87.5% · éxito en tareas 92.5% · TTFV 3.0 min ·
adherencia 79.2%) y **2 en ámbar** —CES 5.38/7 y confianza en las cifras 3.92/5—, ambos apuntando al
mismo cuello de botella: **interpretar lo que muestra Analytics**.
