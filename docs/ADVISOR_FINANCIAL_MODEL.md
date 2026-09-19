# The advisor's financial model

What the advisor computes, in enough detail to reproduce every number without
reading the code.

Model version at the time of writing: **3.0.0**. Every result carries its
version; see `docs/ADVISOR_MODEL_VERSIONING.md` for why that matters and what
has changed between versions.

Companion documents:

- `docs/FINANCIAL_ASSUMPTIONS.md` — the register of every number that is assumed
  rather than observed, with its source.
- `docs/ADVISOR_MODEL_VERSIONING.md` — version history and the rule for bumping.

Everything below is deterministic given the user's inputs. Nothing in the engine
reads the clock or `Math.random()`.

---

## The worked example

One plan is carried through the whole document. Every figure quoted is real
output, regenerated from the code, not illustrative.

| Input | Value |
|---|---|
| Age | 30 |
| Monthly income | $40,000 |
| Risk tolerance (1–10) | 5 |
| Experience (0–3) | 2 |
| Reaction to a 20% loss (0–3) | 3 |
| Horizon | 20 years |
| Income stability (0–3) | 3 |
| Share of income investable | 20% |
| Initial capital | $50,000 |
| Monthly contribution | $4,000 |
| Goal | $2,500,000 |
| Seed | 20260912 |
| Simulations | 1,000 |

---

## 1. Profile

Two scores are computed independently and the **lower** of the two wins.

`src/lib/utils/investment-profile.ts`

### Psychological score

```
puntaje = riesgo + experiencia * 2 + reaccion * 2

puntaje <= 12  ->  0  Conservador
puntaje <= 20  ->  1  Moderado
otherwise      ->  2  Agresivo
```

### Financial capacity score

```
puntos = 0
edad   < 35            -> +2      else edad < 55            -> +1
ingresos > 50,000      -> +2      else ingresos > 20,000    -> +1
horizonte > 7          -> +2      else horizonte > 3        -> +1
puntos += estabilidad
porcentajeInversion > 30 -> +2    else > 10                 -> +1

puntos <= 4  ->  0
puntos <= 8  ->  1
otherwise    ->  2
```

### The combination

```
nivel = min(psicologico, financiera)
```

Taking the minimum is deliberate: willingness to bear risk and ability to bear
it are different things, and the binding one is whichever is lower. A person
comfortable with volatility but on an unstable income is not an aggressive
investor.

### Worked

```
psicologico = 5 + 2*2 + 3*2 = 15   -> 1 (Moderado)
financiera  = 2 (edad 30) + 1 (ingresos 40k) + 2 (horizonte 20)
            + 3 (estabilidad) + 1 (20% invertible) = 9  -> 2 (Agresivo)
nivel = min(1, 2) = 1              -> Moderado
```

---

## 2. Allocation

A fixed model portfolio per profile. `CARTERAS` in
`src/lib/utils/investment-profile.ts`.

| Asset | Conservador | Moderado | Agresivo |
|---|---:|---:|---:|
| CETES | 40% | 20% | — |
| Bonos | 30% | 20% | — |
| ETF S&P500 | 20% | 35% | 40% |
| ETF Nasdaq | — | 15% | 25% |
| ETF Emergentes | — | — | 20% |
| FIBRAS | 10% | 10% | 10% |
| Oro | — | — | 5% |

Amounts are split with `allocateMoney` (largest-remainder), so the rows add back
to the total exactly rather than losing pesos to per-row rounding.

**Worked** — $50,000 at the Moderado weights: CETES $10,000, Bonos $10,000, ETF
S&P500 $17,500, ETF Nasdaq $7,500, FIBRAS $5,000. Sum: $50,000.

---

## 3. Expected return

`RENDIMIENTOS`, one figure per profile. **Assumed, not measured** — these are
properties of the model portfolio above, not of anything the user holds.

| Profile | Expected annual return |
|---|---:|
| Conservador | 4% |
| Moderado | 7% |
| Agresivo | 11% |

Registered in `docs/FINANCIAL_ASSUMPTIONS.md`. The worked example uses **7%**.

---

## 4. Annual to monthly conversion

Compounding, not division:

```
tasaMensual = (1 + max(-0.99, rendimientoAnual))^(1/12) - 1
```

The `-0.99` floor exists because `(1 + r)^(1/12)` is NaN for `r < -1`, and a NaN
propagates silently through every figure downstream.

**Worked** — `1.07^(1/12) - 1 = 0.0056541454`, i.e. 0.5654% per month. Note that
7%/12 = 0.5833% would be wrong: it compounds to 7.23% a year.

Volatility converts by the square root of time instead:

```
sigmaMensual = volatilidadAnual / sqrt(12)
```

**Worked** — `0.10 / sqrt(12) = 0.0288675135`, i.e. 2.887% per month. See §8.

The **simulation** (§6) states the same annual return as the drift of the
scenario engine's lognormal step, `ln(1 + rendimientoAnual)`, so a simulated
year grows by `1 + r` on average and a path with no volatility follows this
compound-interest projection exactly.

---

## 5. Deterministic projection

The compound-interest table: what the plan produces if the expected return is
realised every single month, with no randomness at all.

```
value = capitalInicial
repeat for each of (años * 12) months:
    value = value * (1 + tasaMensual) + aportacionMensual

capitalAportado    = capitalInicial + aportacionMensual * meses
ganancia           = valorFinal - capitalAportado
rentabilidadTotal% = ganancia / capitalAportado * 100
```

Contributions are added at the **end** of each month, so the first contribution
earns no return in the month it arrives.

### Worked

```
capitalAportado    = 50,000 + 4,000 * 240 = $1,010,000
valorFinal         = $2,223,630
ganancia           = $1,213,630
rentabilidadTotal  = 120.16%
```

This is the figure in the "Resumen Financiero" block, and it is deliberately
**not** the same as the simulated median (§7). The gap is volatility drag.

---

## 6. Monte Carlo

Since model 3.0.0 the advisor runs on the **scenario engine**
(`src/lib/services/scenario-engine.ts`): the same draws and the same monthly
step as every other projection in the app. Before it, the advisor had its own
generator and its own arithmetic step, and the same plan gave two answers
depending on which screen asked. A test (`advisor-on-engine.test.ts`) pins that
a plan evaluated by the advisor and the same plan run through
`runScenario(scenarioFromPlan(plan))` produce the same distribution.

### The scenario set

Shocks are drawn **once**, up front, into a `ScenarioSet` (`planShocks`), and
every question about the plan is answered against that same set — common random
numbers.

```
for each simulation i:
    next = createNormalSampler(pathSeed(seed, i))   # one stream per path
    for each month:
        shock = next()                              # Box-Muller, both halves used

pathSeed(seed, i) = splitmix32 of seed and i        # neighbouring paths unrelated
```

`createNormalSampler` is mulberry32 feeding Box-Muller, using both values of each
pair; the implementation is in `src/lib/utils/random.ts`, and `pathSeed` in
`src/lib/services/monte-carlo.ts`.

**Why one shared set.** With fresh randomness per call, raising a contribution
could lower the reported probability purely by luck, and the recommended
contribution would be scored against a different universe than the one it was
solved in. Common random numbers make a difference between two plans a
difference between the plans.

**Why one stream per path.** A path's first months do not depend on how many
months are drawn, so a longer horizon extends every path instead of reshuffling
them. That is what lets the sensitivity table and the strategy comparison put a
25-year plan beside a 20-year one on the same luck.

The seed is derived from the user's own inputs, so the same plan always produces
the same answer, and it is reported alongside every result.

### The monthly step

One function, used by every simulation loop in the advisor — the engine's
`planMonthFactor`, the factor `runScenario` applies to a single holding:

```
drift  = (ln(1 + rendimientoAnual) - volatilidadAnual^2 / 2) / 12
factor = exp(drift + volatilidadAnual / sqrt(12) * shock)
value  = value * factor + aportacionMensual
```

Lognormal: a month can lose almost everything but never more, so no floor is
needed on the step. `ln(1 + r)` takes the annual return as effective — a year's
growth averages `1 + r` — and the `- σ²/2` keeps that mean while the median falls
as volatility rises (volatility drag). `rendimientoAnual` is floored at −99%
before the logarithm.

### Extending a set

`analizarSensibilidad` and the strategy comparison need horizons longer than the
plan. Each path has its own stream, so the set is simply drawn again for more
months: every month already drawn comes back unchanged, and the rest is
appended. (Until 3.0.0 one stream fed every path in turn, and a longer set had
to borrow its extra months from a second generator.)

---

## 7. Distribution

Percentiles of the sorted final values, **interpolated between ranks** — the
scenario engine's definition, so the advisor's P10 and the engine's P10 are the
same statistic (2.x took the nearest rank):

```
position   = (n - 1) * p
percentile = sorted[floor(position)] + (sorted[ceil(position)] - sorted[floor(position)]) * (position - floor(position))
```

Deciles rather than min and max: the extremes of a simulation are the least
stable statistics it produces. A "worst case" moves every run and says more
about the number of draws than about risk.

### Worked — final values after 240 months

| | Value |
|---|---:|
| P10 | $1,463,182 |
| P25 | $1,736,403 |
| **P50 (median)** | **$2,132,887** |
| P75 | $2,633,738 |
| P90 | $3,156,418 |

The median ($2,132,887) sits **below** the deterministic projection
($2,223,630). That gap is volatility drag, and it is real: the geometric mean of
a volatile series is below its arithmetic mean.

### Bands over time

The same percentiles taken at each year boundary, which is what the projection
chart draws. The last year is identical to the table above by construction.

| Year | P10 | P50 | P90 | Paid in |
|---:|---:|---:|---:|---:|
| 1 | $92,945 | $102,209 | $112,723 | $98,000 |
| 5 | $294,951 | $353,935 | $424,683 | $290,000 |
| 10 | $592,835 | $765,346 | $1,008,255 | $530,000 |
| 20 | $1,463,182 | $2,132,887 | $3,156,418 | $1,010,000 |

---

## 8. Volatility

`VOLATILIDADES`, one figure per profile, **assumed** from the composition of the
model portfolio:

| Profile | Assumed annual volatility |
|---|---:|
| Conservador | 5% |
| Moderado | 10% |
| Agresivo | 16% |

### The square-root-of-time scaling

Monthly shocks are independent, so their variances add and their standard
deviations grow with the square root of time. To produce an annual standard
deviation of σ from twelve monthly steps, each step must carry σ/√12.

Getting this wrong is not a small error. Model 2.0.0 drew a fresh
*annual-equivalent* return each month and converted the whole thing to a monthly
rate, which averages twelve independent annual draws inside each year and
divides the realised standard deviation by √12:

| Profile | Documented | Delivered by 2.0.0 |
|---|---:|---:|
| Conservador | 5% | 1.4% |
| Moderado | 10% | 2.7% |
| Agresivo | 16% | 4.4% |

Every probability computed under 2.0.0 was therefore too confident. Fixed in
2.1.0; the tests measure realised volatility and assert it lands within sampling
error of the documented figure, and still do under 3.0.0's lognormal step.

---

## 9. Probability

The fraction of simulated paths that finish at or above the goal:

```
probabilidadPct = count(final >= meta) / simulations * 100
```

Nothing more sophisticated. It is a **model probability**, conditional on the
assumed return and volatility being right, and it is not a probability about the
world.

**Worked** — 298 of 1,000 paths finish at or above $2,500,000: **29.8%**.

A plan with no goal reports `null` rather than zero.

---

## 10. Required contribution

The contribution that reaches a target probability, found by bisection **against
the same scenario set** the probability is measured on.

```
if probability(0) >= objetivo: return 0

high = max(100, |aportacionMensual|)
while probability(high) < objetivo:
    high *= 2
    if high > 1e9: return null            # unreachable at any sane amount

low = 0
repeat up to 60 times, while high - low > 0.01:
    mid = (low + high) / 2
    if probability(mid) >= objetivo: high = mid
    else:                            low = mid

answer = round(high) to the cent
return probability(answer) >= objetivo ? answer : answer + 0.01
```

The final re-check exists because rounding down to the cent can drop the answer
just under the target.

**Why bisection and not an annuity formula.** The closed-form payment that lands
exactly on the goal assumes the expected return is realised every month; landing
on the mean is roughly a coin flip, so that figure scores near 50%, not 75%.
Solving against the same simulated paths makes the loop close: feed the
recommendation back in and the model agrees.

**Worked** — target 75%: **$5,911.55 per month**, against the $4,000 actually
being contributed.

---

## 11. Sensitivity

Six inputs, each varied down and up around the current plan, everything else
held fixed and every row scored on the same scenario set.

| Input | Values swept |
|---|---|
| Contribution | ×0.8, actual, ×1.2 |
| Horizon | −5 years (min 1), actual, +5 years |
| Initial capital | ×0.8, actual, ×1.2 |
| Goal | ×0.8, actual, ×1.2 |
| Expected return | −2pp, actual, +2pp |
| Volatility | −5pp (min 0), actual, +5pp |

Each row reports the resulting probability and its change against the current
plan in percentage points.

### Worked

```
Expected return   5% -> 9.6%    7% -> 29.8%    9% -> 59.7%
Horizon          15y -> 1.0%   20y -> 29.8%   25y -> 75.9%
Contribution   3,200 -> 12.1% 4,000 -> 29.8% 4,800 -> 51.2%
```

The most useful row is usually the expected return. Two percentage points of an
assumed number — a number nobody can know — move the answer from 10% to 60%,
which is a far larger swing than a 20% change in the contribution the user
actually controls.

---

## 12. Goal date

When each simulated path **first** reaches the goal.

```
for each path:
    walk months forward using the same monthly step
    record the first month where value >= meta
    if it never happens, count the path as "never"

probabilidadPct = (total - never) / total * 100

percentiles are taken over ALL paths, not just arrivals:
    rank = ceil(p/100 * total)
    if rank > arrivals.length: return null
    return arrivals[rank - 1]
```

Two decisions worth stating. "First" arrival counts even if the path later falls
back, because someone planning around a date cares about arrival. And the
percentile is taken over every path, so a goal that most paths miss has **no**
median date rather than a flattering one computed over the survivors.

**Worked** — 336 of 1,000 paths reach $2,500,000 at some point (33.6%); 664
never do. The 25th-percentile arrival is month 230. There is **no median date**,
because fewer than half the paths arrive at all.

Note 33.6% (ever reach) against 29.8% (finish above). Arrivals must be at least
as common as finishing above, since a path can touch the goal and fall back.
A test asserts that invariant, because it is what breaks if the two loops ever
stop sharing the monthly step.

---

## 13. Limitations

What the model does not include at all:

- **Inflation.** Every figure is nominal. $2,132,887 in 2046 buys materially
  less than it does today. This is the single largest omission.
- **Costs, commissions and spreads.** All returns are gross.
- **Taxes.** No ISR on gains, no withholding on interest or dividends.
- **Dividends.** The engine measures price return, not total return.
- **Fat tails.** Shocks are normal, so monthly returns are lognormal. Real markets produce extreme moves more
  often than a normal distribution allows, so the P10 here is optimistic about
  how bad a bad case gets.
- **Correlation and rebalancing.** The portfolio is modelled as a single asset
  with one expected return and one volatility. No covariance between the
  holdings, no rebalancing, no drift in the weights.
- **Sequence beyond the horizon.** Nothing about withdrawals, or what happens
  after the plan ends.
- **Real holdings.** The return and volatility come from the model portfolio for
  the profile, not from anything the user owns.

---

## 14. Assumptions

Every non-observed number the advisor uses:

| Assumption | Value | Kind | Where |
|---|---|---|---|
| Expected return | 4% / 7% / 11% by profile | assumed | `RENDIMIENTOS` |
| Volatility | 5% / 10% / 16% by profile | assumed | `VOLATILIDADES` |
| Model portfolios | fixed weights per profile | assumed | `CARTERAS` |
| Simulations | 1,000 | assumed | advisor page |
| Target confidence | 75% | assumed | advisor page |
| Annual return floor | −99% | guard | `MIN_ANNUAL_RETURN` (projection), `planDrift` (simulation) |
| Simulated drift | ln(1 + expected return) | convention | `planDrift` (scenario engine) |
| Months per year | 12 | convention | — |
| Shock distribution | normal (Box-Muller, one stream per path), lognormal step | assumed | `planShocks`, `planMonthFactor` (scenario engine) |
| Bisection cap | contribution up to 1e9, 60 iterations | guard | `aporteParaProbabilidadMeta` |
| Slow-run threshold | 2,000 ms | assumed | `advisor-telemetry.ts` |

Full sourcing in `docs/FINANCIAL_ASSUMPTIONS.md`.

---

## 15. Versioning

`ADVISOR_MODEL_VERSION` names the engine, and every `PlanOutcome` carries it
alongside the seed, the simulation count, the horizon and the two assumptions.
Those, plus the user's own inputs, reproduce any result exactly.

**Bump the version whenever a change moves the numbers a saved projection would
produce** — how paths are simulated, how percentiles are taken, the assumptions,
the target confidence, or any guard that alters an outcome. Renaming a field or
adding a metric that does not affect the existing ones does not count.

A stored plan on an older version is never silently recomputed in place. See
`docs/ADVISOR_MODEL_VERSIONING.md`.

---

## 16. Reproducing the example

```ts
import {
  buildScenarios, evaluarPlan, aporteParaProbabilidadMeta,
  analizarSensibilidad, proyectarFechaMeta, bandasDeIncertidumbre,
} from '@/lib/services/advisor'
import { obtenerPerfilFinal, RENDIMIENTOS, VOLATILIDADES } from '@/lib/utils/investment-profile'

const perfil = obtenerPerfilFinal({
  edad: 30, ingresos: 40000, riesgo: 5, horizonte: 20,
  experiencia: 2, estabilidad: 3, reaccion: 3, porcentajeInversion: 20,
})                                              // -> { nivel: 1, nombre: 'Moderado' }

const params = {
  capitalInicial: 50_000,
  aportacionMensual: 4_000,
  años: 20,
  rendimientoAnual: RENDIMIENTOS[perfil.nivel],   // 0.07
  volatilidadAnual: VOLATILIDADES[perfil.nivel],  // 0.10
}

const scenarios = buildScenarios({ months: 240, simulations: 1000, seed: 20260912 })
const plan = evaluarPlan(params, 2_500_000, scenarios)

plan.proyeccionDeterminista.valorFinal              // 2,223,630
plan.distribucion.p50                               // 2,132,887
plan.probabilidadMetaPct                            // 29.80
aporteParaProbabilidadMeta(params, 2_500_000, 75, scenarios)   // 5,911.55
```

Every figure quoted in this document comes from that snippet. If a change moves
any of them, either the change is a bug or the version needs bumping and this
table needs regenerating — that is the point of writing them down.
