# Tríptico InvestTracker

Folleto de tres paneles que explica qué es InvestTracker, por qué existe, qué problema
resuelve, cómo funciona y cómo empezar a usarlo.

| Archivo | Qué es |
| --- | --- |
| `triptico-investtracker.pdf` | **Listo para imprimir.** A4 apaisado, 2 páginas (cara exterior e interior). |
| `triptico-investtracker.html` | Pieza autocontenida: tipografías incrustadas, sin recursos externos. Se ve igual en cualquier equipo. |
| `triptico.src.html` | Plantilla editable. **Edita este archivo**, no el anterior. |

## Cómo imprimirlo

A4 horizontal, **doble cara volteando por el lado corto**, tamaño real (100%, sin ajustar a
página) y sin márgenes. Papel recomendado: couché mate de 150–200 g.

Al doblar: primero el panel derecho hacia adentro, luego el izquierdo encima. La portada
queda al frente.

```
Cara exterior:   [ Contraportada ] [ Solapa ] [ PORTADA ]
Cara interior:   [ Por qué existe ] [ Qué es ] [ Cómo funciona ]
```

## Cómo editarlo

```bash
# 1. Edita docs/marketing/triptico.src.html
# 2. Reconstruye la versión autocontenida:
node scripts/triptico/incrustar-fuentes.mjs
# 3. Exporta el PDF: abre el HTML en el navegador → Imprimir → Guardar como PDF
```

**Los seis paneles tienen alto fijo (210 mm) y recortan lo que se desborda.** Si agregas
contenido, verifica que siga cabiendo: en el navegador, un panel con desbordamiento tendrá
`scrollHeight > clientHeight`.

## Decisiones de diseño

- **Paleta:** modernismo mexicano — cal `#FBF6F1`, tinta `#191539`, añil `#3B36C7`,
  rosa mexicano `#E8336D`, ocre `#F2A81D` y jade `#0FA98C`.
- **Tipografías:** Big Shoulders (titulares), Work Sans (lectura) y Red Hat Mono (cifras),
  todas con licencia SIL Open Font License e incrustadas como data URI.
- **Ilustraciones:** SVG dibujado a mano dentro del propio archivo. No hay imágenes externas.

## Sobre el contenido

Todas las afirmaciones describen funcionalidad que existe en el código: los ocho módulos,
los mercados (NYSE, NASDAQ, BMV), las tres monedas, la importación y exportación en CSV, y
los perfiles del Asesor con sus carteras (`src/lib/utils/investment-profile.ts`).

**No se incluyen testimonios ni cifras de satisfacción.** Los resultados de
`docs/research/encuestas-simuladas/` provienen de datos simulados y presentarlos como prueba
social sería inventar evidencia. Si el tríptico se usa en un contexto académico donde el
estudio piloto sí deba aparecer, agrégalo con la etiqueta «estudio simulado, n=24».

El aviso legal de la contraportada —que la plataforma no ejecuta operaciones, no custodia
dinero y no es asesoría de inversión— **debe conservarse** en cualquier versión.

La dirección impresa (`project-tri0w.vercel.app`) sale de `src/app/sitemap.ts`. Si se
registra un dominio propio, hay que actualizarla en `triptico.src.html` (aparece 3 veces).
