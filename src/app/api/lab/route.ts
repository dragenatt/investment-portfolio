import { createServerSupabase } from '@/lib/supabase/server'
import { success, error } from '@/lib/api/response'
import { apiHandler } from '@/lib/api/handler'
import {
  listExperiments,
  runExperiment,
  defaultParams,
  type ExperimentId,
} from '@/lib/services/lab'

/**
 * The experiment catalogue, or one experiment's results.
 *
 * `GET /api/lab` lists everything, including the experiments whose engine is not
 * built yet — those carry `available: false` and a reason. Hiding them would let
 * the lab quietly look complete.
 *
 * `GET /api/lab?experiment=diversification&assets=20&correlation=0` runs one.
 */
async function getHandler(req: Request) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return error('Unauthorized', 401)

  const url = new URL(req.url)
  const requested = url.searchParams.get('experiment')

  if (!requested) {
    // The run functions are not serialisable; the catalogue carries everything
    // a page needs to render the controls.
    return success(
      listExperiments().map((experiment) => ({
        id: experiment.id,
        title: experiment.title,
        objective: experiment.objective,
        concept: experiment.concept,
        params: experiment.params,
        questions: experiment.questions,
        available: experiment.available,
        unavailableReason: experiment.unavailableReason ?? null,
        defaults: defaultParams(experiment.id),
      })),
    )
  }

  const experiment = listExperiments().find((e) => e.id === requested)
  if (!experiment) return error(`Unknown experiment: ${requested}`, 404)

  if (!experiment.available) {
    return success({
      id: experiment.id,
      title: experiment.title,
      available: false,
      reason: experiment.unavailableReason,
      result: null,
    })
  }

  // Every parameter arrives as a string; anything unparseable falls through to
  // the experiment's own clamping rather than being rejected here.
  const params: Record<string, number> = {}
  for (const spec of experiment.params) {
    const raw = url.searchParams.get(spec.key)
    params[spec.key] = raw === null ? spec.default : Number(raw)
  }

  const result = runExperiment(experiment.id as ExperimentId, params)

  return success({
    id: experiment.id,
    title: experiment.title,
    objective: experiment.objective,
    concept: experiment.concept,
    questions: experiment.questions,
    params: experiment.params,
    used: params,
    available: true,
    result,
  })
}

export const GET = apiHandler(getHandler)
