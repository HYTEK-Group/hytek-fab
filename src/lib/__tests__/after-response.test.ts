import { describe, it, expect, vi, beforeEach } from 'vitest'

const scheduled: Array<() => Promise<void>> = []
vi.mock('next/server', () => ({ after: (cb: () => Promise<void>) => { scheduled.push(cb) } }))
vi.mock('../fab-progress', () => ({ computeAndPublishProgress: vi.fn(async () => {}) }))

import { runAfterResponse, publishProgressAfterResponse } from '../after-response'
import { computeAndPublishProgress } from '../fab-progress'

describe('runAfterResponse', () => {
  beforeEach(() => { scheduled.length = 0 })

  it('does not run the work until after() fires it', async () => {
    const work = vi.fn(async () => {})
    runAfterResponse('t', work)
    expect(work).not.toHaveBeenCalled()
    await scheduled[0]()
    expect(work).toHaveBeenCalledOnce()
  })

  it('logs, never rethrows, when the work throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    runAfterResponse('boom', async () => { throw new Error('hub down') })
    await expect(scheduled[0]()).resolves.toBeUndefined()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('boom'), expect.any(Error))
    err.mockRestore()
  })

  it('publishProgressAfterResponse schedules the job rollup', async () => {
    publishProgressAfterResponse('job-1')
    expect(computeAndPublishProgress).not.toHaveBeenCalled()
    await scheduled[0]()
    expect(computeAndPublishProgress).toHaveBeenCalledWith('job-1')
  })
})
