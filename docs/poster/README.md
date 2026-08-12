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

## Datos de identificación

Ya están puestos, tomados de `InvestTracker_Entregable.docx`: Universidad Politécnica de Pachuca,
Ingeniería Financiera, Proyecto Integrador I (INFI0304); autores Anguiano Samaniego Diego Gael,
Brito González Rolando Angello y Hernández Estrada Gerardo; asesor Dr. Omar Santillán Díaz.
Están en `poster.src.html`, bloque `.autoria`.

## Sistema de identidad por sección

Cada sección es una ficha de papel con **canto superior de color** y una **ficha numerada** del
mismo color, para que se distingan a distancia sin romper la armonía:

| Sección | Color |
| --- | --- |
| 01 Introducción | rosa mexicano `#E8336D` |
| 02 Objetivos | añil `#3B36C7` |
| 03 Metodología | ocre `#F2A81D` |
| 04 Resultados | jade `#0FA98C` |
| 05 Conclusiones | lila `#7A76E0` |
| 06 Referencias · 07 Recursos | tinta `#191539` |

Los **seis objetivos específicos** van en cuadrícula 2×3, cada uno con su color de la misma paleta
y su fondo claro correspondiente. El numeral de cada ficha usa cal o tinta según cuál dé más
contraste sobre su color.

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

## Metodología: validación por triangulación

La sección 03 toma la metodología del entregable (apartado 3.10, *Técnicas de Prueba y
Validación*) y la organiza en tres vías independientes:

| Vía | Técnica | Origen |
| --- | --- | --- |
| **A** | Grupo de expertos | Entregable 3.10 a — asesor, coordinador de la licenciatura y grupo académico |
| **B** | Pruebas con usuarios · beta (n = 8) | Entregable 3.10 b — abril a junio de 2026, SUS 82/100 |
| **C** | Tablero de indicadores (n = 24, simulado) | Complemento — instrumento ampliado, `docs/research/` |

**La vía C es el complemento añadido.** El entregable ya tenía dos técnicas de validación; lo que
faltaba era el marco que las une. Encuadrarlas como triangulación —juicio disciplinar, conducta
observada e instrumento de medición— convierte tres ejercicios sueltos en un diseño metodológico,
y hace que el conjunto simulado tenga un papel claro: validar el instrumento antes del
levantamiento ampliado, no sustituir a los usuarios reales.

El origen simulado de la vía C se declara en la propia vía, en los resultados y en las
limitaciones. Con sección de referencias en la lámina, declarar la procedencia de los datos es lo
que separa un piloto metodológico de un resultado empírico.

Dato notable para la defensa: la beta real dio **SUS 82/100** y el tablero ampliado **82.3/100**.
Dos mediciones independientes que coinciden refuerzan ambas.

## Decisiones de diseño

- **Paleta y tipografías heredadas del tríptico** (`docs/marketing/`), para que las dos piezas
  se lean como una sola familia.
- **Cuerpo de texto a 22 pt** sobre A0: legible a ~2 m, la distancia habitual de lectura de un
  póster en sesión de carteles.
- **Figuras numeradas con nota al pie**: 1 motor de Monte Carlo · 2 interfaz del panel ·
  3 adopción por módulo.
- Las cifras de la vía B vienen del entregable; las de la vía C, de
  `docs/research/encuestas-simuladas/data/kpis.json`.
