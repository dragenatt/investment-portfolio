# Referencias bibliográficas — InvestTracker

Las diez obras que dan fundamento a los modelos financieros que InvestTracker
calcula. Cada entrada va en formato APA 7 e indica en qué parte del proyecto se
aplica.

## 1. Markowitz (1952): teoría moderna de carteras

Markowitz, H. (1952). Portfolio selection. *The Journal of Finance, 7*(1), 77–91.
https://doi.org/10.1111/j.1540-6261.1952.tb01525.x

Es la base de la optimización media-varianza y de la frontera eficiente
(`src/lib/services/optimizer.ts`, `robust-optimizer.ts`, `/api/analytics/[pid]/optimization`).
La matriz de covarianzas que usan el optimizador y Monte Carlo
(`covariance.ts`) parte de este marco.

## 2. Sharpe (1966): rendimiento ajustado por riesgo

Sharpe, W. F. (1966). Mutual fund performance. *The Journal of Business, 39*(1), 119–138.
https://doi.org/10.1086/294846

Define el ratio de Sharpe, la métrica de riesgo más usada en la app (panel de
riesgo, comparador, leaderboard de Discover y la cartera de máximo Sharpe del
optimizador).

## 3. Sortino y Price (1994): riesgo a la baja

Sortino, F. A., & Price, L. N. (1994). Performance measurement in a downside risk
framework. *The Journal of Investing, 3*(3), 59–64.
https://doi.org/10.3905/joi.3.3.59

Fundamenta el ratio de Sortino, que solo penaliza la volatilidad negativa y
complementa al Sharpe (`calculateSortinoRatio` en `asset-metrics.ts`, usado por
`/api/analytics/[pid]/risk`, el comparador y las estadísticas de cada activo).

## 4. Black y Litterman (1992): combinar equilibrio de mercado y opiniones

Black, F., & Litterman, R. (1992). Global portfolio optimization. *Financial
Analysts Journal, 48*(5), 28–43. https://doi.org/10.2469/faj.v48.n5.28

Base de `black-litterman.ts`: obtiene los retornos implícitos del mercado y los
ajusta con las *views* del usuario y su confianza (`tau`), para evitar las
soluciones extremas de Markowitz con estimaciones ruidosas.

## 5. Rockafellar y Uryasev (2000): optimización del CVaR

Rockafellar, R. T., & Uryasev, S. (2000). Optimization of conditional
value-at-risk. *Journal of Risk, 2*(3), 21–41.
https://doi.org/10.21314/JOR.2000.038

Sustenta el cálculo de VaR/CVaR (`var.ts`, Monte Carlo) y la estrategia de
mínimo CVaR (`minimiseCVaRWeights` en `allocation-strategies.ts`).

## 6. Maillard, Roncalli y Teïletche (2010): paridad de riesgo

Maillard, S., Roncalli, T., & Teïletche, J. (2010). The properties of equally
weighted risk contribution portfolios. *The Journal of Portfolio Management,
36*(4), 60–70. https://doi.org/10.3905/jpm.2010.36.4.060

Define la cartera de contribución al riesgo igualada (Risk Parity) de
`allocation-strategies.ts` y la atribución de riesgo por activo
(`risk-attribution.ts`, `/api/analytics/[pid]/risk-sources`).

## 7. Jorion (2006): Value at Risk

Jorion, P. (2006). *Value at risk: The new benchmark for managing financial
risk* (3.ª ed.). McGraw-Hill.

Referencia para los tres métodos de VaR que compara `var.ts`: histórico,
paramétrico (normal) y Cornish-Fisher, que corrige por asimetría y colas
gruesas.

## 8. Fama y French (1993): factores de riesgo

Fama, E. F., & French, K. R. (1993). Common risk factors in the returns on
stocks and bonds. *Journal of Financial Economics, 33*(1), 3–56.
https://doi.org/10.1016/0304-405X(93)90023-5

Base de la regresión de factores de `factors.ts` y del job
`src/lib/jobs/kinds/factors.ts` (vista de fuentes de riesgo): mercado, tamaño
(SMB) y valor (HML), más momentum. La app los aproxima con ETF (IWM−SPY,
IWD−IWF, MTUM−SPY) en lugar de las series académicas.

## 9. Glasserman (2003): simulación Monte Carlo

Glasserman, P. (2003). *Monte Carlo methods in financial engineering*. Springer.
https://doi.org/10.1007/978-0-387-21617-1

Guía de la simulación con movimiento browniano geométrico y shocks
correlacionados mediante la descomposición de Cholesky (`monte-carlo.ts`,
`covariance.ts`), que usan los escenarios (`scenario-engine.ts`), el asesor y
el Lab.

## 10. Wilder (1978): indicadores técnicos

Wilder, J. W., Jr. (1978). *New concepts in technical trading systems*. Trend
Research.

Define el RSI(14) con los umbrales 30/70 (`calculateRSI` en
`src/lib/utils/indicators.ts`) que usan el gráfico de precios, las señales
(`signal.ts`) y las reglas de estrategia del Lab (`strategy-rule.ts`).
