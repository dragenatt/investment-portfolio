# InvestTracker — Speech de presentación (≤ 3 minutos)

**Duración objetivo:** 2:55 · ~400 palabras · ritmo ~140 palabras/min
**Formato:** presentación de producto (demo, pitch interno, entrega de proyecto)

---

## Apertura — el problema *(0:00 – 0:25)*

¿Cuánto ganaste realmente con tus inversiones el año pasado?

La mayoría no lo sabe. Tenemos acciones en una app, cripto en otra, CETES en el
banco, y un Excel que nadie actualiza. **InvestTracker** nace justo de ahí: de la
pregunta más simple y peor respondida de las finanzas personales — *¿cómo voy?*

## Qué es *(0:25 – 0:55)*

InvestTracker es una plataforma web que reúne todo tu patrimonio invertido en un
solo lugar. Soporta **seis tipos de activo** — acciones, ETFs, cripto, bonos y
CETES, divisas y commodities — de la Bolsa Mexicana y de mercados de Estados
Unidos, y **todo se convierte automáticamente a tu moneda base**: pesos, dólares
o euros.

Registras tus operaciones, o importas tu historial por CSV, y el sistema calcula
tu costo promedio, tu posición actual y tu rendimiento real.

## Qué hace — el recorrido *(0:55 – 1:45)*

En el dashboard ves lo esencial: valor total, ganancia del día, rendimiento
acumulado, mejor y peor posición.

Pero lo interesante está un nivel más abajo, en **analítica**: rendimiento
ponderado por tiempo y por dinero —TWR y MWR, como lo miden los profesionales—,
volatilidad, Sharpe, máximo drawdown, comparación contra un benchmark,
atribución por activo y por sector, y análisis de dividendos.

Encima de eso hay tres capas:

1. **Alertas** de precio y de concentración, que te avisan cuando un activo pesa
   demasiado en tu cartera.
2. Un **asesor** que te perfila —conservador, moderado o agresivo— y simula si
   vas a alcanzar tu meta usando Monte Carlo.
3. Una capa **social**: portafolios públicos, leaderboard y comparación entre
   carteras, siempre con control de privacidad.

## Cómo está construido *(1:45 – 2:25)*

Por dentro: **Next.js 16 con React 19** desplegado en Vercel. **Supabase** como
base de datos, con Row Level Security: cada usuario solo ve lo suyo. Un **Worker
en Cloudflare** que actualiza precios por cron y funciona como motor de datos.
**Caché en Redis** para que las pantallas carguen rápido sin quemar cuotas de
API. Y **tres proveedores de mercado** —Yahoo Finance, Finnhub y Twelve Data—
con *fallback* entre ellos: si uno falla, la aplicación sigue en pie.

Todo con pruebas automatizadas, modo oscuro, PWA y soporte en español e inglés.

## Cierre — hacia dónde va *(2:25 – 2:55)*

¿Qué sigue? Un **motor cuantitativo en Python** —optimización de portafolio y
rebalanceo inteligente— y una **capa de inteligencia** que detecte anomalías y
clasifique noticias del mercado.

En una frase: InvestTracker convierte un Excel disperso en una respuesta clara a
*«¿cómo voy, y qué debería hacer?»*.

Gracias.

---

## Notas de entrega

- **Si te sobra tiempo:** agrega un ejemplo real ("aquí ves que Apple aporta el
  40% del rendimiento pero también el 30% del riesgo").
- **Si te falta tiempo:** recorta la sección social y el roadmap; la apertura y
  analítica son el corazón del mensaje.
- **Pausa fuerte** después de la pregunta inicial y antes de "En una frase".
- **Evita** entrar en detalle técnico durante la sección de arquitectura: son
  40 segundos, es un inventario, no una explicación.
