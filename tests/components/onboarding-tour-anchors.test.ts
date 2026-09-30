import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOUR_STEPS } from '@/components/shared/onboarding-tour'

/**
 * The tour points at elements by CSS selector, across files, with nothing
 * linking the two. Removing an attribute or renaming a tag does not fail a
 * build or a type check — the tour simply finds nothing, leaves the spotlight
 * null, and dims the whole screen while describing something the reader cannot
 * see.
 *
 * That is not hypothetical. Both `data-tour` anchors had gone missing from the
 * app: no element anywhere carried them, so steps 2 and 3 were broken on every
 * page, dashboard included, and the tour was reported as "it doesn't really
 * show you anything".
 *
 * These read source rather than render, deliberately: rendering the dashboard
 * means standing up a dozen hooks, and what is worth guarding is only that the
 * two files still agree.
 */

const root = join(__dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const DASHBOARD = 'src/app/(app)/dashboard/page.tsx'
const SIDEBAR = 'src/components/layout/sidebar.tsx'
const TOPBAR = 'src/components/layout/topbar.tsx'

describe('onboarding tour anchors', () => {
  it('every data-tour selector matches an attribute the dashboard renders', () => {
    const dashboard = read(DASHBOARD)

    const dataTourSteps = TOUR_STEPS.filter((s) => s.targetSelector?.startsWith('[data-tour='))
    // If this drops to zero the test below is vacuous, so assert the shape too.
    expect(dataTourSteps.length).toBeGreaterThan(0)

    for (const step of dataTourSteps) {
      const name = step.targetSelector!.match(/\[data-tour="([^"]+)"\]/)?.[1]
      expect(name, `${step.targetSelector} is not a [data-tour="…"] selector`).toBeDefined()
      expect(
        dashboard.includes(`data-tour="${name}"`),
        `The tour step "${step.title}" points at [data-tour="${name}"], but nothing in ${DASHBOARD} carries that attribute. ` +
          'Either restore the attribute or change the step.',
      ).toBe(true)
    }
  })

  it('the element selectors still name elements the app shell renders', () => {
    const shell = read(SIDEBAR) + read(TOPBAR)

    for (const step of TOUR_STEPS) {
      const selector = step.targetSelector
      if (!selector || selector.startsWith('[')) continue
      expect(
        shell.includes(`<${selector}`),
        `The tour step "${step.title}" points at <${selector}>, which neither the sidebar nor the topbar renders any more.`,
      ).toBe(true)
    }
  })

  it('the tour is mounted where its anchors live', () => {
    // The steps describe the dashboard, so that is the page that has to mount
    // it. It used to be mounted only by the settings page, which meant a new
    // user never saw it and restarting it ran the tour over the wrong page.
    expect(read(DASHBOARD)).toContain('<OnboardingTour')
  })
})
