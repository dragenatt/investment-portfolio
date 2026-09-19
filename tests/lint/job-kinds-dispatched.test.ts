// @vitest-environment node
//
// 4.8. backtest and stress had job kinds, a runner and a policy — and their
// screens called the synchronous routes, so the jobs never ran. Every job kind
// must be dispatched by a hook, through useJob.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { JOB_KINDS } from '@/lib/services/jobs'

const HOOKS = path.resolve(__dirname, '../../src/lib/hooks/use-analytics.ts')

describe('every background job kind has a screen that starts it', () => {
  const source = fs.readFileSync(HOOKS, 'utf8').replace(/\s+/g, ' ')

  for (const kind of JOB_KINDS) {
    it(`${kind} is started through useJob`, () => {
      expect(source).toMatch(new RegExp(`useJob<[^>]*>\\('${kind}'`))
    })
  }
})
