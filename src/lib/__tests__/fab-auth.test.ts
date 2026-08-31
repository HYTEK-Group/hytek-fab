import { describe, it, expect } from 'vitest'
import { kioskCaller, supabaseCaller } from '../fab-auth'
import { sameHuman, canClearException } from '../fab-gatekeeper'

// Proves the PIN→login link (sql/014-fab-pin-login-link.sql, fab_pins.profile_id)
// actually closes the four-eyes gap it was built for: before this link, the ONLY
// way a kiosk PIN and a Supabase login were recognised as the same human was a
// normalised NAME match (fab-gatekeeper.sameHuman's documented "honest limit").
// A worker whose kiosk PIN name doesn't match their login's full name (nickname,
// shortened name, typo) slipped through as two different people. Once their PIN
// carries profile_id, kioskCaller mints them the SAME `sb:<uuid>` key as their
// login — sameHuman matches on that key with no reliance on names at all.
describe('fab-auth caller identity — PIN linked to a login', () => {
  it('a LINKED PIN is the same human as its login even when the names do not match (the real gap this closes)', () => {
    const kiosk = kioskCaller('Scotty', 'admin', 'uuid-scott') // kiosk nickname
    const login = supabaseCaller({ id: 'uuid-scott', role: 'admin', fullName: 'Scott Textor', email: null }) // login full name
    expect(kiosk.key).toBe(login.key) // both sb:uuid-scott
    expect(sameHuman(kiosk, login)).toBe(true)
  })

  it('an UNLINKED PIN with a non-matching name is correctly treated as a different person (no false link)', () => {
    const kiosk = kioskCaller('Scotty', 'admin') // no profile_id
    const login = supabaseCaller({ id: 'uuid-scott', role: 'admin', fullName: 'Scott Textor', email: null })
    expect(kiosk.key).toBe('pin:Scotty')
    expect(sameHuman(kiosk, login)).toBe(false)
  })

  it('an UNLINKED PIN whose name DOES match a login still matches via the legacy name-fallback (unchanged behaviour)', () => {
    const kiosk = kioskCaller('Scott Textor', 'admin') // no profile_id — old floor-crew PIN
    const login = supabaseCaller({ id: 'uuid-scott', role: 'admin', fullName: 'Scott Textor', email: null })
    expect(sameHuman(kiosk, login)).toBe(true)
  })

  it('a PIN linked to profile A is a different person from a login for profile B', () => {
    const kiosk = kioskCaller('Scotty', 'admin', 'uuid-scott')
    const login = supabaseCaller({ id: 'uuid-jamie', role: 'admin', fullName: 'Jamie', email: null })
    expect(sameHuman(kiosk, login)).toBe(false)
  })

  describe('four-eyes: canClearException using the linked identity', () => {
    it('blocks an admin clearing an exception THEY raised under their linked kiosk PIN', () => {
      const kiosk = kioskCaller('Scotty', 'admin', 'uuid-scott')
      const login = supabaseCaller({ id: 'uuid-scott', role: 'admin', fullName: 'Scott Textor', email: null })
      const result = canClearException({ clearer: login, raisedBy: kiosk, clearerRole: 'admin', alreadyCleared: false })
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/different admin/i)
    })

    it('lets a genuinely different admin clear an exception the linked PIN raised', () => {
      const kiosk = kioskCaller('Scotty', 'admin', 'uuid-scott')
      const otherLogin = supabaseCaller({ id: 'uuid-jamie', role: 'admin', fullName: 'Jamie', email: null })
      const result = canClearException({ clearer: otherLogin, raisedBy: kiosk, clearerRole: 'admin', alreadyCleared: false })
      expect(result.ok).toBe(true)
    })

    it('before linking, the same nickname/name mismatch would have wrongly let the self-clear through — the link is what fixes it', () => {
      const unlinkedKiosk = kioskCaller('Scotty', 'admin') // pre-link state: name doesn't match the login
      const login = supabaseCaller({ id: 'uuid-scott', role: 'admin', fullName: 'Scott Textor', email: null })
      // Without a link, key AND name both fail to match → wrongly treated as different people → self-clear allowed.
      expect(canClearException({ clearer: login, raisedBy: unlinkedKiosk, clearerRole: 'admin', alreadyCleared: false }).ok).toBe(true)
    })
  })
})
