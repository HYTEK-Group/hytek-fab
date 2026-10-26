// Server-only. Run Hub-feed work AFTER the response has gone back to the floor.
//
// Every floor write (kiosk Start/Done, QC, dispatch, proof photo, package
// update) used to await the Hub publish before answering — up to the 8-second
// Hub timeout in hub-events.ts on every tap. The user's own database write is
// still awaited in the route before it responds; only the derived Hub feed moves
// here, via Next's after() (next/server), which keeps the function alive until
// the callback settles.
//
// Nothing about delivery changes: sendFabEventLogged still records a genuine
// failure in fab_events as 'hub_send_failed'. This wrapper only adds a
// console.error for anything that throws, so a crash in the background is never
// silent.
import { after } from 'next/server'
import { computeAndPublishProgress } from './fab-progress'

export function runAfterResponse(label: string, work: () => Promise<unknown>): void {
  after(async () => {
    try {
      await work()
    } catch (err) {
      console.error(`[fab after-response] ${label} failed:`, err)
    }
  })
}

/** Recompute this job's rollup and tell the Hub, once the response has been sent. */
export function publishProgressAfterResponse(fabJobId: string): void {
  runAfterResponse(`fab_progress ${fabJobId}`, () => computeAndPublishProgress(fabJobId))
}
