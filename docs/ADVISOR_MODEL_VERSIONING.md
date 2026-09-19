# Advisor model versioning

A projection is not a fact about the world, it is the output of a model with
particular assumptions on a particular day. Two years from now a saved plan that
says "78% probability" is meaningless unless it also says which model produced
it, from which assumptions, on which draws.

`ADVISOR_MODEL_VERSION` in `src/lib/services/advisor.ts` names the model. Every
`PlanOutcome` carries a `modelo` block with it.

## What every result carries

| Field | Why it is kept |
|---|---|
| `version` | Which engine produced the number. |
| `seed` | The draw. With it, the exact scenario set can be rebuilt. |
| `simulaciones` | How many paths. A probability from 100 paths is not the same claim as one from 10,000. |
| `meses` | The horizon actually simulated. |
| `rendimientoAnual` | The expected return assumed. |
| `volatilidadAnual` | The volatility assumed. |

Together with the user's own inputs — capital, contribution, horizon, goal —
that is everything needed to reproduce the result exactly. Nothing in the engine
reads the clock or `Math.random()`.

## Versioning rule

**Bump the version whenever a change moves the numbers a saved projection would
produce.** That includes:

- changing how paths are simulated or how percentiles are taken
- changing the expected-return or volatility assumptions
- changing the target confidence the recommended contribution solves for
- changing the return floor or any other guard that alters an outcome

It does not include renaming a field, adding a metric that does not affect the
existing ones, or changing wording.

**A historical projection is never silently overwritten.** When a stored plan
carries an older version, recompute into a *new* record and keep the old one.
The comparison between them is the interesting object: it shows the user that
the answer moved because the model changed, not because their plan did.

## Version history

### 3.0.0 — one engine (task 4.9)

**What was wrong with 2.1.0.** Nothing inside it, measured on its own. The
problem was that it was a second engine. The advisor drew its shocks from its
own generator (`mulberry32` + `standardNormal`, one stream for every path in
turn) and stepped them with its own arithmetic monthly return; every other
projection in the app — the portfolio's scenario engine, the Monte Carlo cone —
used correlated geometric Brownian motion. The same plan had two answers
depending on which screen asked.

**What 3.0.0 does.** The advisor runs on the scenario engine:

- **Draws** — `planShocks`: one `createNormalSampler` stream per path, seeded by
  `pathSeed(seed, path)`. A path's first months do not depend on the horizon,
  so a longer horizon extends the same paths (this replaced the second-stream
  workaround `extendScenarios` needed under 2.x).
- **Step** — `planMonthFactor`: the engine's lognormal factor,
  `exp((ln(1+r) − σ²/2)/12 + σ/√12·z)`. `ln(1 + r)` reads the profile's return
  as effective, so mean growth is `1 + r` a year and a path with no volatility
  follows the compound-interest projection exactly. The −100% monthly floor is
  gone: a lognormal step cannot cross it.
- **Percentiles** — the engine's, interpolated between ranks, instead of the
  nearest rank.

A test pins that `evaluarPlan` and `runScenario(scenarioFromPlan(plan))` give
the same distribution for the same seed and path count.

**How far the numbers moved.** On the documented example (Moderado, $50,000 +
$4,000/month, 20 years, goal $2,500,000, seed 20260912): median $2,135,458 →
$2,132,887; probability 30.1% → 29.8%; contribution for 75%: $5,800.64 →
$5,911.55; first arrival P25: month 231 → 230. Same assumptions, same process
family, different draws and step: a plan saved under 2.1.0 is not reproducible
under 3.0.0 and must not be compared with one recomputed now as if only the
plan had changed.

The scenario engine moved to 2.0.0 in the same change (one stream per path).

### 2.1.0 — the shocks deliver the volatility they claim

**What was wrong with 2.0.0.** The monthly step drew a fresh *annual-equivalent*
return each month and converted the whole thing to a monthly rate:

```
const annual = rendimientoAnual + shock * volatilidadAnual
value = value * (1 + monthlyRate(annual)) + aportacion
```

Averaging twelve independent annual draws inside one year divides the realised
annual standard deviation by sqrt(12). Measured on 20,000 one-year paths:

| Profile | Documented volatility | Delivered by 2.0.0 |
|---|---|---|
| Conservador | 5% | 1.4% |
| Moderado | 10% | 2.7% |
| Agresivo | 16% | 4.4% |

So the engine contradicted the register in `docs/FINANCIAL_ASSUMPTIONS.md` that
it was supposed to be implementing. The consequence was not cosmetic: every
probability the advisor reported was computed against a market three and a half
times calmer than the assumed one, and was therefore too confident. The
uncertainty fan added in D7 was that much too narrow, and volatility drag — the
median falling as spread widens at a fixed mean return — was largely erased, so
risk looked close to free.

**What 2.1.0 does instead.** The shock is scaled to a monthly standard
deviation, which is the same sqrt(time) convention used everywhere else in this
codebase for annualising:

```
const monthly = monthlyRate(rendimientoAnual) + shock * volatilidadAnual / sqrt(12)
```

Realised volatility now lands within sampling error of the documented figure at
all three profiles, and volatility drag reappears. The monthly return is floored
at -100% rather than the annual return at -99%; the guard is at the level the
arithmetic actually happens.

**Effect on saved plans.** Every probability moves, most of them down. A plan
recorded under 2.0.0 is not comparable with one recorded under 2.1.0, which is
what the version field is for.

Found while implementing D7: the fan drawn for a 20-year plan at 10% volatility
spanned barely +-10%, which is not what 10% annual volatility looks like over
twenty years.

### 2.0.0 — the scenario set

Replaced the engine that lived in `src/lib/utils/investment-profile.ts`.

**What was wrong with 1.x.** Three faults that fed each other:

1. **Fresh randomness on every call.** `Math.random()` was drawn inside each
   simulation loop, so asking the same question twice gave different answers and
   comparing two contribution levels compared two different universes. Raising a
   contribution could *lower* the reported probability, purely from luck.

2. **Two halves answering different questions.** "How much should I contribute"
   was answered by `aporteNecesario`, the deterministic annuity payment that
   lands exactly on the goal *if the expected return is realised every month*.
   That figure was then scored by a stochastic simulation, where landing on the
   mean is roughly a coin flip. So the advisor recommended an amount, the user
   entered it, and the advisor reported the goal was still unlikely. This is the
   circular recommendation the roadmap describes, and no amount of tuning fixes
   it while the recommendation and the score come from different models.

3. **A latent NaN.** `Math.pow(1 + r, 1/12)` is NaN whenever `r` is below -100%.
   Unreachable at the old fixed 10% volatility, but one configuration change
   away.

**What 2.0.0 does instead.** Shocks are drawn once, from a seeded generator,
into a `ScenarioSet`. Every question about a plan is answered against that same
set — common random numbers — so a difference between two plans is a difference
between the plans. `aporteParaProbabilidadMeta` then bisects against the *same*
simulated paths the probability is measured on, which makes the loop close by
construction: feed the recommendation back in and the model agrees, because it
is answering with the same universe it used to pick the number.

Also in 2.0.0:

- **Deciles instead of extremes.** P10/P25/P50/P75/P90 replaced min/mean/max.
  The extremes of a simulation are its least stable statistics — the "worst
  case" moves every run and says more about the number of draws than about risk.
- **Per-profile volatility.** A flat 0.10 was applied to all three profiles,
  which is the one number that cannot be right for all of them. See
  `VOLATILIDADES` and `docs/FINANCIAL_ASSUMPTIONS.md`.
- **The return floor.** Simulated annual returns are floored at -99%, so the
  monthly conversion never sees a negative base.
- **Money to the cent.** Every monetary figure goes through `money.ts`, so
  nothing renders as `$999.9999999997`.
- **The deterministic projection is kept and shown separately** from the
  simulated distribution, and never conflated with it. `aporteNecesario` also
  survives, documented as the deterministic figure it is, and explicitly not as
  a recommendation.

### 1.0.0 — original

`simulacionMonteCarlo`, `probabilidadMeta` and unseeded `gaussianRandom` in
`src/lib/utils/investment-profile.ts`. Removed in 2.0.0 rather than left in
place, since dead code with a known defect invites someone to call it.

## Not yet versioned

Projections are not persisted yet. When a `goals` table lands (roadmap P1-8),
the `modelo` block is what should be written alongside the user's inputs, and
the rule above is what should govern recomputation.
