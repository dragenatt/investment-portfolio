# Póster científico — InvestTracker

Lámina A0 vertical (84,1 × 118,9 cm) con la estructura académica completa: título,
introducción, objetivos, metodología en diagrama de flujo, resultados con figuras y tablas,
discusión y conclusiones, referencias y recursos con códigos QR.

| Archivo | Qué es |
| --- | --- |
| `poster-investtracker.pdf` | **Listo para imprenta.** 1 página, 84,1 × 118,9 cm. |
| `poster-investtracker.html` | Pieza autocontenida: tipografías y QR incrustados, sin recursos externos. |
| `poster.src.html` | Plantilla editable. **Edita este archivo**, no el anterior. |
| `qr/*.svg` | Códigos QR generados y verificados. |

## Campos por llenar

La cabecera tiene cuatro campos en blanco: **autores**, **institución / programa**, **asesor**
y **fecha**. Están en `poster.src.html`, en el bloque `.autoria`.

## Cómo editarlo

```bash
# 1. Edita docs/poster/poster.src.html
# 2. Reconstruye la versión autocontenida:
node scripts/poster/construir.mjs
# 3. Exporta el PDF: abre el HTML en el navegador → Imprimir → Guardar como PDF,
#    tamaño 100 %, sin márgenes.
```

**Las tres columnas tienen alto fijo y recortan lo que se desborde.** Si agregas contenido,
verifica que siga cabiendo: un bloque con desbordamiento tendrá `scrollHeight > clientHeight`.

## Códigos QR

```bash
npm i -D qrcode jsqr pngjs
node scripts/poster/generar-qr.mjs
```

El script genera cada QR **y lo verifica decodificándolo de vuelta**: si no decodifica a la URL
exacta, falla en vez de producir un código ilegible. Los destinos se editan en la constante
`DESTINOS`.

| Destino | Estado |
| --- | --- |
| Repositorio | ✅ `github.com/dragenatt/investment-portfolio` |
| Plataforma en vivo | ✅ `project-tri0w.vercel.app` |
| Presentación ejecutiva | ⬜ Pendiente: agrega la URL en `DESTINOS` y vuelve a ejecutar |
| Documento y tríptico | ⬜ Pendiente: igual que el anterior |

Mientras un destino sea `null`, el póster dibuja un marcador punteado en su lugar.

## Sobre el encuadre del estudio

El póster presenta el trabajo como **estudio piloto de validación de instrumento y tablero
sobre un conjunto de datos simulado**, y lo dice en el subtítulo, en la fase 04 de la
metodología, en las limitaciones y en el pie de la lámina.

No es un adorno de cautela: en un documento con sección de referencias, declarar el origen de
los datos es lo que separa un piloto metodológico de un resultado empírico. Además hace más
sólido el trabajo — la aportación es el tablero reproducible, no las cifras concretas. Si
alguien pregunta «¿son usuarios reales?», la respuesta ya está impresa.

## Decisiones de diseño

- **Paleta y tipografías heredadas del tríptico** (`docs/marketing/`), para que las dos piezas
  se lean como una sola familia.
- **Cuerpo de texto a 21 pt** sobre A0: legible a ~2 m, que es la distancia habitual de lectura
  de un póster en sesión de carteles.
- **Figuras y tablas numeradas** (Figuras 1–3, Tablas 1–2) con nota al pie, en formato académico.
- Todas las cifras provienen de `docs/research/encuestas-simuladas/data/kpis.json`.
