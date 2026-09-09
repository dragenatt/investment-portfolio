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
