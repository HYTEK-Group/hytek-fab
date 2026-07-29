import { describe, it, expect } from 'vitest'
import {
  isExceptionKind, statusRank, isBackwardStatus, sameHuman, canClearException, foldExceptions,
  type RawEvent, type Identity,
} from '../fab-gatekeeper'

describe('isExceptionKind', () => {
  it('recognises the five exception kinds and nothing else', () => {
    expect(isExceptionKind('dispatch_override')).toBe(true)
    expect(isExceptionKind('proven_piece_unstaged')).toBe(true)
    expect(isExceptionKind('exception_cleared')).toBe(false) // the clear is not itself an exception
    expect(isExceptionKind('mark_status_changed')).toBe(false)
  })
})

describe('isBackwardStatus', () => {
  it('flags erasing proven work (done/qc_passed pushed down)', () => {
    expect(isBackwardStatus('done', 'in_progress')).toBe(true)
    expect(isBackwardStatus('qc_passed', 'not_started')).toBe(true)
    expect(isBackwardStatus('qc_passed', 'done')).toBe(true) // un-passing QC still counts
    expect(isBackwardStatus('sub_certified', 'in_progress')).toBe(true)
  })
  it('does NOT flag a send-out to a contractor (a proven piece going for treatment)', () => {
    expect(isBackwardStatus('done', 'at_contractor')).toBe(false)     // legit send-out
    expect(isBackwardStatus('qc_passed', 'at_contractor')).toBe(false) // legit send-out
  })
  it('does NOT flag normal forward progress or contractor round-trips', () => {
    expect(isBackwardStatus('not_started', 'in_progress')).toBe(false)
    expect(isBackwardStatus('in_progress', 'done')).toBe(false)
    expect(isBackwardStatus('returned', 'at_contractor')).toBe(false) // lateral, below proven floor
    expect(isBackwardStatus('done', 'qc_passed')).toBe(false)         // forward
    expect(isBackwardStatus('done', 'done')).toBe(false)              // no change
  })
  it('ranks unknown statuses as 0 (never a reversion source)', () => {
    expect(statusRank('gibberish')).toBe(0)
    expect(isBackwardStatus('gibberish', 'not_started')).toBe(false)
  })
})

describe('sameHuman', () => {
  const sb = (id: string, name: string): Identity => ({ key: `sb:${id}`, ns: 'supabase', name })
  const pin = (name: string): Identity => ({ key: `pin:${name}`, ns: 'kiosk', name })
  it('matches the same login by stable key', () => {
    expect(sameHuman(sb('u1', 'Scott Textor'), sb('u1', 'Scott T'))).toBe(true) // same uuid, diff label
  })
  it('treats different logins as different', () => {
    expect(sameHuman(sb('u1', 'Scott Textor'), sb('u2', 'Jamie'))).toBe(false)
  })
  it('matches a kiosk name to a login name across namespaces (closes the four-eyes gap)', () => {
    expect(sameHuman(pin('Scott Textor'), sb('u1', 'Scott Textor'))).toBe(true)
    expect(sameHuman(pin('scott textor'), sb('u1', 'Scott  Textor'))).toBe(true) // case/space-insensitive
  })
  it('does not match genuinely different people across namespaces', () => {
    expect(sameHuman(pin('Bob the welder'), sb('u1', 'Scott Textor'))).toBe(false)
  })
})

describe('canClearException (four-eyes)', () => {
  const scottLogin: Identity = { key: 'sb:scott', ns: 'supabase', name: 'Scott Textor' }
  const jamieLogin: Identity = { key: 'sb:jamie', ns: 'supabase', name: 'Jamie' }
  const scottPin: Identity = { key: 'pin:Scott Textor', ns: 'kiosk', name: 'Scott Textor' }
  const base = { clearer: jamieLogin, raisedBy: scottLogin, clearerRole: 'admin', alreadyCleared: false }

  it('lets a different admin clear', () => {
    expect(canClearException(base).ok).toBe(true)
  })
  it('blocks the same login clearing its own', () => {
    expect(canClearException({ ...base, clearer: scottLogin }).ok).toBe(false)
  })
  it('blocks a login clearing a kiosk exception it raised under its own name (the real hole)', () => {
    expect(canClearException({ ...base, clearer: scottLogin, raisedBy: scottPin }).ok).toBe(false)
  })
  it('blocks non-admins', () => {
    expect(canClearException({ ...base, clearerRole: 'supervisor' }).ok).toBe(false)
  })
  it('blocks a second clear of an already-cleared exception', () => {
    expect(canClearException({ ...base, alreadyCleared: true }).ok).toBe(false)
  })
})

describe('foldExceptions', () => {
  const ev = (p: Partial<RawEvent>): RawEvent => ({
    id: 'e1', fab_job_id: 'J1', kind: 'dispatch_override', actor: 'Scott',
    detail: null, created_at: '2026-07-29T01:00:00Z', ...p,
  })

  it('separates open from cleared and attaches who/when/note', () => {
    const events = [
      ev({ id: 'e1', kind: 'dispatch_override', actor: 'Scott', created_at: '2026-07-29T01:00:00Z' }),
      ev({ id: 'e2', kind: 'onsite_date_changed', actor: 'Scott', created_at: '2026-07-29T02:00:00Z' }),
      ev({ id: 'c1', kind: 'exception_cleared', actor: 'Jamie', created_at: '2026-07-29T03:00:00Z',
           detail: { cleared_event_id: 'e1', note: 'legacy job, ok' } }),
    ]
    const { open, cleared } = foldExceptions(events)
    expect(open.map(e => e.id)).toEqual(['e2'])
    expect(cleared.map(e => e.id)).toEqual(['e1'])
    expect(cleared[0].cleared_by).toBe('Jamie')
    expect(cleared[0].cleared_at).toBe('2026-07-29T03:00:00Z')
    expect(cleared[0].clear_note).toBe('legacy job, ok')
  })

  it('ignores clears that point at nothing, and non-exception kinds', () => {
    const events = [
      ev({ id: 'e1', kind: 'mark_status_changed' }),                       // not an exception
      ev({ id: 'c9', kind: 'exception_cleared', detail: { cleared_event_id: 'ghost' } }),
    ]
    const { open, cleared } = foldExceptions(events)
    expect(open).toHaveLength(0)
    expect(cleared).toHaveLength(0)
  })

  it('earliest clear wins by TIMESTAMP regardless of feed order (prod feeds DESC)', () => {
    const first = ev({ id: 'c1', kind: 'exception_cleared', actor: 'Jamie', created_at: '2026-07-29T03:00:00Z', detail: { cleared_event_id: 'e1', note: 'first' } })
    const second = ev({ id: 'c2', kind: 'exception_cleared', actor: 'Nobody', created_at: '2026-07-29T04:00:00Z', detail: { cleared_event_id: 'e1', note: 'second' } })
    const raise = ev({ id: 'e1', kind: 'dispatch_override' })
    // DESC feed (newest first) — the production ordering — must still credit the FIRST clear.
    const { cleared } = foldExceptions([second, first, raise])
    expect(cleared).toHaveLength(1)
    expect(cleared[0].cleared_by).toBe('Jamie')
    expect(cleared[0].clear_note).toBe('first')
  })

  it('sorts newest first', () => {
    const events = [
      ev({ id: 'old', created_at: '2026-07-01T00:00:00Z' }),
      ev({ id: 'new', created_at: '2026-07-29T00:00:00Z' }),
    ]
    expect(foldExceptions(events).open.map(e => e.id)).toEqual(['new', 'old'])
  })
})
